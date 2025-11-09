use axum::{
    extract::{State, Json},
    response::Json as ResponseJson,
    http::StatusCode,
};
use scraper::{Html, Selector};
use crate::models::*;
use sqlx::PgPool;

type AppState = (PgPool, String, String, Option<String>); // (pool, api_key, jwt_secret, supabase_jwt_secret)

pub async fn fetch_law_content_handler(
    State((pool, _, _, _)): State<AppState>,
    Json(request): Json<FetchLawContentRequest>,
) -> Result<ResponseJson<LawContent>, StatusCode> {
    match fetch_law_content_direct(request.url, &pool).await {
        Ok(content) => Ok(ResponseJson(content)),
        Err(e) => {
            eprintln!("Failed to fetch law content: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn fetch_law_content_direct(url: String, pool: &PgPool) -> Result<LawContent, String> {
    println!("🔍 DEBUG: Fetching URL: {}", url);

    // Extract law name from URL for caching (fallback only)
    let law_name = extract_law_name_from_url(&url);
    
    // Check cache first
    if let Ok(Some(cached)) = get_cached_law(law_name.clone(), pool).await {
        println!("✅ DEBUG: Using cached content for: {}", law_name);
        return Ok(LawContent {
            title: law_name,
            content: cached.content,
        });
    }
    
    let response = reqwest::get(&url)
        .await
        .map_err(|e| {
            let error = format!("Failed to fetch URL: {}", e);
            println!("❌ DEBUG: {}", error);
            error
        })?;
    
    println!("✅ DEBUG: HTTP response received, status: {}", response.status());
    
    let html_content = response
        .text()
        .await
        .map_err(|e| {
            let error = format!("Failed to read response: {}", e);
            println!("❌ DEBUG: {}", error);
            error
        })?;

    println!("✅ DEBUG: HTML content received, length: {} chars", html_content.len());
    
    let result = parse_law_content(html_content);
    match result {
        Ok(content) => {
            println!("✅ DEBUG: Law content parsed - Title: {}, Content: {} chars",
                   content.title, content.content.len());

            // Clean content but don't cache here - let caller handle caching with proper law name
            let cleaned_content = clean_content_for_ai(&content.content);

            // Return cleaned content
            Ok(LawContent {
                title: content.title,
                content: cleaned_content,
            })
        },
        Err(e) => {
            println!("❌ DEBUG: Failed to parse law content: {}", e);
            Err(e)
        }
    }
}

async fn get_cached_law(law_name: String, pool: &PgPool) -> Result<Option<LawCache>, String> {
    let cached_law = sqlx::query_as::<_, LawCache>(
        "SELECT id, law_name, law_url, content, cached_at, expires_at FROM law_cache WHERE law_name = $1 AND expires_at > NOW() LIMIT 1"
    )
    .bind(law_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to check cached law: {}", e))?;
    
    Ok(cached_law)
}

fn extract_law_name_from_url(url: &str) -> String {
    // Extract a meaningful name from the URL for caching
    if let Some(captures) = regex::Regex::new(r"/([^/]+)/?$").unwrap().captures(url) {
        captures.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| "unknown_law".to_string())
    } else {
        "unknown_law".to_string()
    }
}

fn parse_law_content(html: String) -> Result<LawContent, String> {
    let document = Html::parse_document(&html);
    
    // Try to get title from h1 or title tag
    let title_selector = Selector::parse("h1, .naslov, .title")
        .map_err(|e| format!("Failed to parse title selector: {}", e))?;
    
    let title = document
        .select(&title_selector)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .unwrap_or_else(|| "Zakon".to_string());

    // Extract main content - paragraf.rs typically uses specific classes
    let content_selectors = vec![
        ".sadrzaj",
        ".content",
        ".zakon-content", 
        "#content",
        "article",
        "main",
        ".main-content"
    ];

    let mut content = String::new();
    
    for selector_str in content_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(content_element) = document.select(&selector).next() {
                content = extract_text_content(content_element);
                break;
            }
        }
    }

    // If no specific content found, try to extract from body but filter out navigation
    if content.is_empty() {
        let body_selector = Selector::parse("body")
            .map_err(|e| format!("Failed to parse body selector: {}", e))?;
        
        if let Some(body) = document.select(&body_selector).next() {
            content = extract_text_content(body);
            
            // Filter out common navigation and footer text
            content = filter_navigation_content(content);
        }
    }

    if content.is_empty() {
        return Err("No content found in the law document".to_string());
    }

    Ok(LawContent { title, content })
}

fn extract_text_content(element: scraper::ElementRef) -> String {
    let mut result = String::new();
    
    // Skip script, style, nav, footer elements
    let skip_selector = Selector::parse("script, style, nav, footer, .nav, .navigation, .menu").unwrap();
    
    extract_text_recursive(element, &mut result, &skip_selector);
    
    result.trim().to_string()
}

fn extract_text_recursive(element: scraper::ElementRef, result: &mut String, skip_selector: &Selector) {
    if skip_selector.matches(&element) {
        return;
    }
    
    let tag_name = element.value().name();
    
    // Handle block elements that should create line breaks
    let is_block_start = matches!(tag_name, "div" | "p" | "br" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li");
    let is_line_break = tag_name == "br";
    
    // Add line break before block elements (except if result is empty)
    if is_block_start && !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    
    // For br tags, just add line break
    if is_line_break {
        result.push('\n');
        return;
    }
    
    // Process child nodes
    for child in element.children() {
        match child.value() {
            scraper::node::Node::Text(text) => {
                let text_content = text.text.trim();
                if !text_content.is_empty() {
                    if !result.is_empty() && !result.ends_with(' ') && !result.ends_with('\n') {
                        result.push(' ');
                    }
                    result.push_str(text_content);
                }
            }
            scraper::node::Node::Element(_) => {
                if let Some(child_element) = scraper::ElementRef::wrap(child) {
                    extract_text_recursive(child_element, result, skip_selector);
                }
            }
            _ => {}
        }
    }
    
    // Add line break after block elements
    if is_block_start && !result.ends_with('\n') {
        result.push('\n');
    }
}

fn filter_navigation_content(content: String) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut filtered_lines = Vec::new();
    
    for line in lines {
        let line_lower = line.to_lowercase();
        
        // Skip common navigation patterns
        if line_lower.contains("navigacija") 
            || line_lower.contains("meni") 
            || line_lower.contains("početna")
            || line_lower.contains("kontakt")
            || line_lower.contains("o nama")
            || line_lower.starts_with("©")
            || line_lower.contains("copyright")
            || line.trim().len() < 10 // Skip very short lines that might be navigation
        {
            continue;
        }
        
        filtered_lines.push(line);
    }
    
    filtered_lines.join("\n")
}

// Simple helper function for internal use during startup




pub fn clean_content_for_ai(content: &str) -> String {
    let mut cleaned_lines = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut found_law_start = false;
    let mut previous_line_empty = false;
    
    for line in lines.iter() {
        let line = line.trim();
        
        // Handle empty lines strategically
        if line.is_empty() {
            // Skip multiple consecutive empty lines before law starts
            if !found_law_start {
                continue;
            }
            
            // Skip multiple consecutive empty lines
            if previous_line_empty {
                continue;
            }
            
            // Preserve single empty lines within law content for formatting
            cleaned_lines.push(String::new());
            previous_line_empty = true;
            continue;
        }
        
        previous_line_empty = false;
        
        // Skip junk content before law starts
        if !found_law_start {
            // Look for law title pattern
            if line.starts_with("ZAKON") || line.contains("OSNOVNE ODREDBE") || line.starts_with("Član ") {
                found_law_start = true;
            } else {
                // Skip Twitter widgets, mailing lists, navigation
                if line.contains("window.twttr") 
                    || line.contains("mailing listu") 
                    || line.contains("Tweet")
                    || line.contains("Sve informacije o propisu nađite")
                    || line.contains("Prijavite se na")
                    || line.len() < 10 // Very short navigation lines
                {
                    continue;
                }
            }
        }
        
        // If we haven't found law start and this doesn't look like junk, include it
        if found_law_start || (!line.contains("window.") && !line.contains("twitter") && !line.contains("mailing")) {
            cleaned_lines.push(line.to_string());
        }
    }
    
    let cleaned = cleaned_lines.join("\n");
    
    // Add proper spacing around articles
    let article_spaced = add_article_spacing(&cleaned);
    
    // Only remove excessive whitespace (4+ newlines), preserve double and triple
    let re = regex::Regex::new(r"\n{4,}").unwrap();
    re.replace_all(&article_spaced, "\n\n").to_string()
}

fn add_article_spacing(content: &str) -> String {
    use regex::Regex;
    
    // Add double line break before each "Član" (except first one)
    let clan_pattern = Regex::new(r"(?m)^(Član \d+[a-z]?)").unwrap();
    let mut result = clan_pattern.replace_all(content, "\n\n$1").to_string();
    
    // Clean up any triple newlines that might have been created
    let cleanup_pattern = Regex::new(r"\n{3,}").unwrap();
    result = cleanup_pattern.replace_all(&result, "\n\n").to_string();
    
    // Trim any leading newlines
    result.trim_start_matches('\n').to_string()
}