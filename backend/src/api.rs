use axum::{
    extract::{State, Json},
    response::Json as ResponseJson,
    http::{StatusCode, HeaderMap},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::models::*;
use crate::database;
use crate::scraper;
use crate::simple_auth;
use crate::laws;
use sqlx::PgPool;

// Helper function to safely find UTF-8 character boundary (stable Rust compatible)
fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        s.len()
    } else {
        let mut idx = index;
        while idx > 0 && !s.is_char_boundary(idx) {
            idx -= 1;
        }
        idx
    }
}

// Helper function to extract client IP from headers (for Fly.io/proxy environments)
pub fn extract_client_ip(headers: &HeaderMap) -> String {
    headers.get("fly-client-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|header| header.to_str().ok())
        .map(|ip_str| ip_str.split(',').next().unwrap_or(ip_str).trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

type AppState = (PgPool, String, String, String); // (pool, openrouter_api_key, openai_api_key, jwt_secret)


#[derive(Debug, Serialize, Deserialize)]
struct OpenRouterMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenRouterRequest {
    model: String,
    messages: Vec<OpenRouterMessage>,
    temperature: f32,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenRouterChoice {
    message: OpenRouterMessage,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenRouterResponse {
    choices: Vec<OpenRouterChoice>,
}

// NEW: Process question with LLM free response (Phase 2)
async fn process_question_with_free_response(
    question: &str,
    recent_messages: &[&Message],
    document_content: Option<&str>,
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
    api_key: &str,
) -> Result<String, String> {
    println!("🔍 DEBUG: Processing question with LLM free response: '{}'", question);

    // Create conversation context with document content if provided
    let user_content = if let Some(doc_content) = document_content {
        format!("{}\n\n[Uploaded Document]\n{}", question, doc_content)
    } else {
        question.to_string()
    };

    // Use the existing create_conversation_messages function for consistency
    let messages = create_conversation_messages(&user_content, document_content, recent_messages);

    // Use the existing call_openrouter_api function for consistency
    println!("🔍 DEBUG: Making OpenRouter API call for free response...");

    let llm_response = call_openrouter_api(api_key, messages, user_id, device_fingerprint, pool).await?;

    println!("🤖 LLM FREE RESPONSE LENGTH: {} chars", llm_response.len());
    if llm_response.len() < 200 {
        println!("🤖 LLM FREE RESPONSE: '{}'", llm_response);
    } else {
        // Safe UTF-8 slicing
        let safe_end = floor_char_boundary(&llm_response, 200);
        println!("🤖 LLM FREE RESPONSE (first 200 chars): '{}'", &llm_response[..safe_end]);
    }

    Ok(llm_response)
}

// Check if a question is related to Serbian law (KEPT per CLAUDE.md)
async fn is_legal_question(question: &str, api_key: &str) -> Result<bool, String> {
    println!("🔍 LEGAL CLASSIFICATION: Starting question classification");

    let classification_prompt = format!(
        r#"You are a legal classification expert. Your task is to determine if a question is related to law, legal procedures, or requires legal knowledge.

Question: "{}"

Classification criteria:
- LEGAL: Questions about laws, penalties, legal procedures, rights, obligations, court processes, legal documents, regulations, lawyers, legal definitions, contracts, legal advice, legal interpretations
- NOT LEGAL: Greetings, casual conversation, technical support, general information unrelated to law, medical questions, non-legal topics

Respond with exactly one word: LEGAL or NOT_LEGAL"#,
        question
    );

    let messages = vec![
        OpenRouterMessage {
            role: "user".to_string(),
            content: classification_prompt,
        }
    ];

    let request = OpenRouterRequest {
        model: "google/gemini-2.5-flash".to_string(), // Much cheaper for simple classification
        messages,
        temperature: 0.0, // Deterministic for classification
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Classification API error: {}", e))?;

    let response_text = response.text().await
        .map_err(|e| format!("Failed to read classification response: {}", e))?;

    println!("🔧 CLASSIFICATION: Raw response text: {}", response_text);

    let parsed_response: OpenRouterResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse classification response: {} - Response: {}", e, response_text))?;

    println!("🔧 CLASSIFICATION: Parsed response choices count: {}", parsed_response.choices.len());

    let classification_result = parsed_response.choices
        .first()
        .ok_or("No classification response received")?
        .message
        .content
        .trim()
        .to_uppercase();

    println!("🔧 CLASSIFICATION: LLM raw content: '{}'", classification_result);

    let is_legal = if classification_result.contains("NOT") || classification_result.contains("NON") {
        // Explicit non-legal response
        false
    } else if classification_result.starts_with("LEG") {
        // Legal response (including truncated "LEG" from "LEGAL")
        true
    } else {
        // Unexpected response - log it and default to true to avoid missing legal questions
        println!("⚠️  CLASSIFICATION: Unexpected LLM response '{}', defaulting to legal for safety", classification_result);
        true
    };

    println!("✅ CLASSIFICATION: '{}' -> response: '{}' -> is_legal = {}", question, classification_result, is_legal);

    Ok(is_legal)
}

// NEW: Article reference replacement system (Phase 3)

// Detect which law is relevant for the question
async fn detect_relevant_law_name(question: &str, api_key: &str) -> Result<String, String> {
    println!("🔍 DEBUG: Detecting relevant law name for question: '{}'", question);

    let law_detection_prompt = format!(
        r#"Analiziraj ovo pravno pitanje i odredi koji je jedan najrelevantniji srpski zakon.

PITANJE: "{}"

INSTRUKCIJE:
1. Vrati SAMO naziv zakona, bez objašnjenja
2. Koristi punu zvaničnu naziv zakona
3. Primeri pravilnih odgovora:
   - "Zakon o bezbednosti saobraćaja na putevima"
   - "Krivični zakonik"
   - "Zakon o radu"
   - "Porodični zakon"

Tvoj odgovor:"#,
        question
    );

    let messages = vec![
        OpenRouterMessage {
            role: "user".to_string(),
            content: law_detection_prompt,
        }
    ];

    let request = OpenRouterRequest {
        model: "google/gemini-2.5-flash".to_string(),
        messages,
        temperature: 0.0,
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Law detection API error: {}", e))?;

    let response_text = response.text().await
        .map_err(|e| format!("Failed to read law detection response: {}", e))?;

    let parsed_response: OpenRouterResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse law detection response: {} - Response: {}", e, response_text))?;

    let detected_law_name = parsed_response.choices
        .first()
        .ok_or("No law detection response received")?
        .message
        .content
        .trim()
        .to_string();

    println!("🔍 DEBUG: Detected law name: '{}'", detected_law_name);
    Ok(detected_law_name)
}

// Detect article references in LLM response (simplified - just look for Član X)
fn detect_article_references_simple(text: &str) -> Vec<String> {
    use regex::Regex;

    println!("🔍 DEBUG: Detecting simple article references in text");

    let mut article_numbers = Vec::new();

    // Simple pattern to match "Član X" - ignore stav/tačka since we extract entire articles
    let pattern = Regex::new(r"Član\s+(\d+[a-z]?)").unwrap();

    for cap in pattern.captures_iter(text) {
        let article_number = cap.get(1).unwrap().as_str().to_string();

        if !article_numbers.contains(&article_number) {
            article_numbers.push(article_number.clone());
            println!("🔍 DEBUG: Found article reference: Član {}", article_number);
        }
    }

    println!("🔍 DEBUG: Total article numbers found: {}", article_numbers.len());
    article_numbers
}

// Get cached article content from database with automatic caching
// Returns: (article_content, actual_law_name_from_db)
async fn get_cached_article(law_name: &str, article_number: &str, pool: &PgPool) -> Result<Option<(String, String)>, String> {
    // Try to get from cache first
    match get_cached_law(law_name.to_string(), pool).await {
        Ok(Some(cached_law)) => {
            println!("✅ DEBUG: Found '{}' in cache", law_name);
            // Extract specific article from law content
            let article_content = extract_article_from_law_text(&cached_law.content, article_number);
            // Return both article content and the actual law name from database
            Ok(article_content.map(|content| (content, cached_law.law_name.clone())))
        }
        Ok(None) => {
            println!("⚠️ DEBUG: Law '{}' not found in cache, attempting to fetch and cache", law_name);

            // Try to find law URL from hardcoded list for automatic caching
            if let Some(law_url) = try_get_law_url(law_name) {
                println!("✅ DEBUG: Found URL for '{}': {}", law_name, law_url);

                // Fetch and cache the law automatically
                match get_law_content(law_name, &law_url, pool).await {
                    Ok(law_content) => {
                        println!("✅ DEBUG: Successfully fetched and cached '{}'", law_name);
                        // Now extract the specific article
                        let article_content = extract_article_from_law_text(&law_content.content, article_number);
                        // Return both article content and the law title (which is the cached name)
                        Ok(article_content.map(|content| (content, law_content.title.clone())))
                    }
                    Err(e) => {
                        println!("❌ DEBUG: Failed to fetch law content for '{}': {}", law_name, e);
                        Ok(None)
                    }
                }
            } else {
                println!("❌ DEBUG: No URL mapping found for law '{}'", law_name);
                Ok(None)
            }
        }
        Err(e) => {
            println!("❌ DEBUG: Error fetching cached law '{}': {}", law_name, e);
            Err(e)
        }
    }
}

// Extract specific article content from law text
fn extract_article_from_law_text(law_content: &str, article_number: &str) -> Option<String> {
    use regex::Regex;

    // Handle different article number formats
    let clean_article_num = article_number.replace(".", "").replace("stav", "").trim().to_string();

    // Pattern to match article sections: "Član X" followed by content until next article
    // Use manual splitting approach since Rust regex doesn't support lookaheads
    let pattern_str = format!(r"(?s)Član\s*{}\s*\.?\s*\n?(.*)", regex::escape(&clean_article_num));
    let pattern = match Regex::new(&pattern_str) {
        Ok(p) => p,
        Err(e) => {
            println!("❌ DEBUG: Regex compilation failed: {}", e);
            return None;
        },
    };

    println!("🔍 DEBUG: Looking for article {} using pattern: {}", clean_article_num, pattern_str);

    // Debug: Show a sample of the law content around the expected article
    if let Some(start_pos) = law_content.find(&format!("Član {}", clean_article_num)) {
        let sample_start = start_pos.saturating_sub(50);
        let sample_end = (start_pos + 300).min(law_content.len());

        // Safe UTF-8 slicing: find the nearest character boundary
        let safe_start = floor_char_boundary(law_content, sample_start);
        let safe_end = floor_char_boundary(law_content, sample_end);
        let sample = &law_content[safe_start..safe_end];

        println!("🔍 DEBUG: Found 'Član {}' in law content. Context: '{}'", clean_article_num, sample);
    } else {
        println!("❌ DEBUG: 'Član {}' not found in law content at all", clean_article_num);
        // Show first 200 chars to see the format - use char boundary safe method
        let safe_end = floor_char_boundary(law_content, 200.min(law_content.len()));
        let sample = &law_content[..safe_end];
        println!("🔍 DEBUG: Law content sample: '{}'", sample);
    }

    if let Some(cap) = pattern.captures(law_content) {
        let full_content = cap.get(1).unwrap().as_str();

        // Manually find the end by looking for the next "Član X"
        let next_article_pattern = Regex::new(r"\nČlan\s+\w+").unwrap();
        let article_content = if let Some(next_match) = next_article_pattern.find(full_content) {
            // Take content up to the next article
            // Regex match positions are always at char boundaries, but being extra safe
            let safe_end = floor_char_boundary(full_content, next_match.start());
            &full_content[..safe_end]
        } else {
            // Take all remaining content
            full_content
        };

        let article_content = article_content.trim();
        if !article_content.is_empty() {
            println!("✅ DEBUG: Found article {} content: {} chars", article_number, article_content.len());
            return Some(format!("**Član {}**\n{}", article_number, article_content));
        }
    }

    println!("❌ DEBUG: Article {} not found in law content", article_number);
    None
}

// Replace article references with cached content using detected law name
async fn replace_article_references_with_law(response: &str, detected_law_name: Option<&str>, pool: &PgPool) -> Result<(QuestionResponse, Option<String>), String> {
    println!("🔍 DEBUG: Starting article replacement with detected law: {:?}", detected_law_name);

    let article_numbers = detect_article_references_simple(response);

    if article_numbers.is_empty() {
        return Ok((QuestionResponse {
            answer: response.to_string(),
            law_quotes: vec![],
            law_name: None,
            generated_contract: None,
        }, None));
    }

    if detected_law_name.is_none() {
        println!("⚠️ DEBUG: No law detected, cannot fetch articles");
        return Ok((QuestionResponse {
            answer: response.to_string(),
            law_quotes: vec![],
            law_name: None,
            generated_contract: None,
        }, None));
    }

    let law_name = detected_law_name.unwrap();
    let mut law_quotes = Vec::new();
    let mut actual_law_name_from_db: Option<String> = None;

    for article_number in article_numbers {
        match get_cached_article(law_name, &article_number, pool).await {
            Ok(Some((article_content, db_law_name))) => {
                law_quotes.push(article_content);
                // Capture the actual law name from database (same for all articles)
                if actual_law_name_from_db.is_none() {
                    actual_law_name_from_db = Some(db_law_name.clone());
                }
                println!("✅ DEBUG: Added content for Član {} from {} (DB: {})", article_number, law_name, db_law_name);
            }
            Ok(None) => {
                println!("⚠️ DEBUG: No content found for Član {} in '{}'", article_number, law_name);
            }
            Err(e) => {
                println!("❌ DEBUG: Error fetching Član {}: {}", article_number, e);
            }
        }
    }

    println!("✅ DEBUG: Article replacement complete. Answer: {} chars, Quotes: {}",
             response.len(), law_quotes.len());

    // Return the actual law name from database if we successfully found articles
    let actual_law_name = if !law_quotes.is_empty() {
        actual_law_name_from_db
    } else {
        None
    };

    Ok((QuestionResponse {
        answer: response.to_string(), // Keep original answer clean
        law_quotes,
        law_name: actual_law_name.clone(),
        generated_contract: None,
    }, actual_law_name))
}

// Helper function to try to get law URL for common laws with flexible matching
fn try_get_law_url(law_name: &str) -> Option<String> {
    let all_laws = laws::get_serbian_laws();

    // First try exact match
    if let Some(law) = all_laws.iter().find(|law| law.name == law_name) {
        println!("✅ DEBUG: Exact match found for '{}'", law_name);
        return Some(law.url.clone());
    }

    // Try case-insensitive match
    let law_name_lower = law_name.to_lowercase();
    if let Some(law) = all_laws.iter().find(|law| law.name.to_lowercase() == law_name_lower) {
        println!("✅ DEBUG: Case-insensitive match found for '{}'", law_name);
        return Some(law.url.clone());
    }

    // Try partial match (law name contains the search term or vice versa)
    if let Some(law) = all_laws.iter().find(|law|
        law.name.to_lowercase().contains(&law_name_lower) ||
        law_name_lower.contains(&law.name.to_lowercase())
    ) {
        println!("✅ DEBUG: Partial match found for '{}' -> '{}'", law_name, law.name);
        return Some(law.url.clone());
    }

    println!("❌ DEBUG: No match found for law name '{}'", law_name);
    println!("🔍 DEBUG: Available laws: {:?}", all_laws.iter().map(|l| &l.name).collect::<Vec<_>>());
    None
}







pub async fn ask_question_handler(
    State((pool, openrouter_api_key, _openai_api_key, jwt_secret)): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<QuestionRequest>,
) -> Result<ResponseJson<QuestionResponse>, StatusCode> {
    println!("🚀 ================== NEW QUESTION REQUEST ==================");
    println!("🔍 DEBUG: Received ask_question request");
    println!("🔍 DEBUG: Request data: question='{}', law_name={:?}, law_url={:?}, chat_id={}, has_document_content={}", 
        request.question, 
        request.law_name, 
        request.law_url, 
        request.chat_id,
        request.document_content.is_some()
    );
    

    let is_manual_law_selection = request.law_name.is_some() && request.law_url.is_some();
    if is_manual_law_selection {
        println!("⚡ MANUAL LAW SELECTION: User specified law, skipping auto-detection");
    } else {
        println!("🤖 AUTO LAW DETECTION: Will use keyword-based law selection process");
    }
    
    // Extract IP address from Fly.io headers (proper way for proxy environments)
    let client_ip = extract_client_ip(&headers);
    
    println!("🔍 DEBUG: Client IP: {}", client_ip);
    
    // Check IP trial limits (max 3 trials per IP)
    println!("🔍 DEBUG: Checking IP trial limits...");
    match simple_auth::check_ip_trial_limits(&pool, &client_ip).await {
        Ok(allowed) => {
            println!("🔍 DEBUG: IP trial check result: allowed={}", allowed);
            if !allowed {
                println!("❌ DEBUG: IP trial limit exceeded");
                // Return HTTP 429 with structured error in response body
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
        }
        Err(e) => {
            println!("❌ DEBUG: IP trial check error: {:?}", e);
            return Err(e.0);
        }
    }
    
    // Extract user info for usage tracking and limit checking
    println!("🔍 DEBUG: Extracting user info...");
    let (user_id, device_fingerprint) = database::extract_user_info(&headers, &jwt_secret);
    println!("🔍 DEBUG: User info - user_id: {:?}, device_fingerprint: {:?}", user_id, device_fingerprint);

    // Validate document upload permission for Professional/Team/Premium users only
    if request.document_content.is_some() {
        let user = database::get_user(user_id, device_fingerprint.clone(), &pool).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(user) = user {
            if !user.can_upload_documents() {
                eprintln!("❌ SECURITY: User with account_type '{}' attempted document upload - BLOCKED", user.account_type);
                return Err(StatusCode::FORBIDDEN);
            }
        } else {
            eprintln!("❌ SECURITY: Unregistered user attempted document upload - BLOCKED");
            return Err(StatusCode::FORBIDDEN);
        }
    }
    
    // Check if user can send message (trial users need remaining messages, premium unlimited)
    println!("🔍 DEBUG: Checking if user can send message...");
    match database::can_send_message(user_id, device_fingerprint.clone(), &pool).await {
        Ok(can_send) => {
            if !can_send {
                println!("❌ DEBUG: User cannot send message - trial limit exceeded");
                // Return HTTP 429 with structured error in response body
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
            println!("✅ DEBUG: User can send message");
        }
        Err(e) => {
            println!("❌ DEBUG: Error checking message limits: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    
    // Process question with new free response system
    println!("🔍 DEBUG: Starting free response processing...");
    let enhanced_response = process_question_with_llm_guidance(
        &request,
        user_id,
        device_fingerprint.clone(),
        &pool,
        &openrouter_api_key,
    ).await.map_err(|e| {
        println!("❌ DEBUG: Free response processing failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    println!("✅ DEBUG: Free response processing successful");

    // Decrement trial messages after successful message processing (skip for premium users)
    let user = database::get_user(user_id, device_fingerprint.clone(), &pool).await
        .map_err(|e| {
            eprintln!("Failed to get user for message decrement check: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if let Some(user) = user {
        if user.account_type != "premium" {
            let device_fp_for_logging = device_fingerprint.clone();
            if let Err(e) = database::decrement_trial_message(user_id, device_fingerprint, &pool).await {
                // Log error but don't fail the request since AI response was successful
                eprintln!("⚠️  CRITICAL: Failed to decrement trial messages for user_id={:?}, device_fingerprint={:?}: {}", user_id, device_fp_for_logging, e);
            } else {
                println!("✅ DEBUG: Successfully decremented trial message count for user_id={:?}, device_fingerprint={:?}", user_id, device_fp_for_logging);
            }
        } else {
            println!("✅ DEBUG: Premium user - skipping trial message decrement");
        }
    }

    println!("✅ DEBUG: Request processing completed successfully");
    Ok(ResponseJson(enhanced_response))
}

// NEW: Process question with free response and article replacement (Phase 4)
async fn process_question_with_llm_guidance(
    request: &QuestionRequest,
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
    api_key: &str,
) -> Result<QuestionResponse, String> {
    // Load recent conversation history for context
    let all_messages = get_messages(request.chat_id, pool).await?;
    let recent_messages: Vec<_> = all_messages.iter().rev().take(10).rev().collect();

    println!("🔍 DEBUG: NEW FREE RESPONSE PROCESSING for question: '{}'", request.question);
    println!("🔍 DEBUG: Has document: {}, doc_length: {}",
        request.document_content.is_some(),
        request.document_content.as_ref().map(|d| d.len()).unwrap_or(0)
    );


    // Step 1: Add user message to database first
    add_message(
        request.chat_id,
        "user".to_string(),
        request.question.clone(),
        None, // No specific law in free response mode
        Some(request.document_content.is_some()),
        request.document_filename.clone(),
        None, // contract_file_id (only for assistant messages)
        None, // contract_type (only for assistant messages)
        None, // contract_filename (only for assistant messages)
        pool,
    ).await?;

    // Step 2: Classify question first (NOT optional!)
    println!("🔍 DEBUG: Classifying question...");
    let is_legal = match is_legal_question(&request.question, api_key).await {
        Ok(legal) => {
            println!("🔍 DEBUG: Question classification: is_legal = {}", legal);
            legal
        }
        Err(e) => {
            println!("⚠️ DEBUG: Classification failed: {}, assuming legal for safety", e);
            true // Default to legal to avoid missing questions
        }
    };

    // Step 3: Branch based on classification
    let llm_response = if is_legal {
        // Legal question: Get LLM free response
        println!("✅ DEBUG: Legal question - proceeding with free response");
        process_question_with_free_response(
            &request.question,
            &recent_messages,
            request.document_content.as_deref(),
            user_id,
            device_fingerprint.clone(),
            pool,
            api_key,
        ).await?
    } else {
        // Non-legal question: Return polite refusal
        println!("❌ DEBUG: Non-legal question - returning refusal");
        "Izvinjavam se, ali mogu da odgovorim samo na pitanja koja se odnose na srpsko pravo i zakonodavstvo. Molim vas da postavite pravno pitanje.".to_string()
    };

    // Step 3: Detect relevant law name from the question
    let detected_law_name = if is_legal {
        println!("🔍 DEBUG: Step 2 - Detecting relevant law name");
        match detect_relevant_law_name(&request.question, api_key).await {
            Ok(law_name) => {
                println!("✅ DEBUG: Detected law: '{}'", law_name);
                Some(law_name)
            }
            Err(e) => {
                println!("⚠️ DEBUG: Law name detection failed: {}, proceeding without specific law", e);
                None
            }
        }
    } else {
        None
    };

    // Step 4: Replace article references with cached content using detected law
    println!("🔍 DEBUG: LLM Response before article replacement: '{}'", llm_response);
    let (mut enhanced_response, actual_law_name) = replace_article_references_with_law(&llm_response, detected_law_name.as_deref(), pool).await?;
    println!("🔍 DEBUG: After article replacement - Answer: '{}', Quotes: {:?}, Law: {:?}",
             enhanced_response.answer, enhanced_response.law_quotes, actual_law_name);

    // Step 4.5: Check for generated contract
    println!("🔍 DEBUG: Checking for contract in LLM response...");
    if let Some((contract_content, clean_response)) = crate::contracts::detect_contract(&llm_response) {
        println!("✅ DEBUG: Contract detected! Content length: {} chars", contract_content.len());

        // Get API base URL from environment or use default
        let api_base_url = std::env::var("API_BASE_URL")
            .unwrap_or_else(|_| "https://norma-ai.fly.dev".to_string());

        // Generate contract file
        match crate::contracts::generate_contract_file(&contract_content, &api_base_url) {
            Ok(contract) => {
                println!("✅ DEBUG: Contract file generated: {}", contract.filename);
                enhanced_response.generated_contract = Some(contract);
                // Update answer to use clean version (without contract markers)
                enhanced_response.answer = clean_response;
            }
            Err(e) => {
                println!("❌ DEBUG: Contract generation failed: {}", e);
                // Don't fail the request, just log the error
            }
        }
    } else {
        println!("🔍 DEBUG: No contract detected in response");
    }

    println!("✅ DEBUG: Free response processing complete. Answer: {} chars, Quotes: {}",
             enhanced_response.answer.len(), enhanced_response.law_quotes.len());

    // Step 4: Add AI response to database
    let response_content = if !enhanced_response.law_quotes.is_empty() {
        let reference_header = if let Some(ref law_name) = actual_law_name {
            format!("Reference: {}", law_name)
        } else {
            "Reference:".to_string()
        };

        format!("{}\n\n{}\n{}",
               enhanced_response.answer,
               reference_header,
               enhanced_response.law_quotes.join("\n\n"))
    } else {
        enhanced_response.answer.clone()
    };

    // Step 5: Save assistant response to database with contract metadata if present
    let (contract_file_id, contract_type, contract_filename) = if let Some(ref contract) = enhanced_response.generated_contract {
        // Extract file_id from download_url (format: /api/contracts/{file_id})
        let file_id = contract.download_url.split('/').last().unwrap_or("").to_string();
        (Some(file_id), Some(contract.contract_type.clone()), Some(contract.filename.clone()))
    } else {
        (None, None, None)
    };

    add_message(
        request.chat_id,
        "assistant".to_string(),
        response_content,
        actual_law_name.clone(), // Save actual law name from database for frontend display
        None, // AI responses don't have documents
        None, // AI responses don't have filenames
        contract_file_id,
        contract_type,
        contract_filename,
        pool,
    ).await?;

    Ok(enhanced_response)
}





async fn get_law_content(
    law_name: &str,
    law_url: &str,
    pool: &PgPool,
) -> Result<LawContent, String> {
    // Check cache first
    if let Ok(Some(cached)) = get_cached_law(law_name.to_string(), pool).await {
        return Ok(LawContent {
            title: law_name.to_string(),
            content: cached.content,
        });
    }

    // Fetch fresh content (this will cache with URL-derived name)
    let law_content = scraper::fetch_law_content_direct(law_url.to_string(), pool).await?;

    // Override cache with correct law name to prevent duplicates
    database::cache_law(
        law_name.to_string(),
        law_url.to_string(),
        law_content.content.clone(),
        24,
        pool,
    ).await?;

    Ok(law_content)
}

async fn get_messages(chat_id: i64, pool: &PgPool) -> Result<Vec<Message>, String> {
    let messages = sqlx::query_as::<_, Message>(
        "SELECT id, chat_id, role, content, law_name, has_document, document_filename, contract_file_id, contract_type, contract_filename, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC"
    )
    .bind(chat_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch messages: {}", e))?;

    Ok(messages)
}

async fn add_message(
    chat_id: i64,
    role: String,
    content: String,
    law_name: Option<String>,
    has_document: Option<bool>,
    document_filename: Option<String>,
    contract_file_id: Option<String>,
    contract_type: Option<String>,
    contract_filename: Option<String>,
    pool: &PgPool,
) -> Result<(), String> {
    // Insert the message
    sqlx::query("INSERT INTO messages (chat_id, role, content, law_name, has_document, document_filename, contract_file_id, contract_type, contract_filename) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
        .bind(chat_id)
        .bind(role)
        .bind(content)
        .bind(law_name)
        .bind(has_document.unwrap_or(false))
        .bind(document_filename)
        .bind(contract_file_id)
        .bind(contract_type)
        .bind(contract_filename)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to add message: {}", e))?;

    // Update the chat's updated_at timestamp
    sqlx::query("UPDATE chats SET updated_at = NOW() WHERE id = $1")
        .bind(chat_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update chat timestamp: {}", e))?;

    Ok(())
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

fn create_conversation_messages(
    current_question: &str,
    document_content: Option<&str>,
    recent_messages: &[&Message]
) -> Vec<OpenRouterMessage> {
    let mut messages = Vec::new();

    // System message with legal instructions (FREE RESPONSE - simplified)
    let system_prompt = r#"Ti si pravni asistent za srpsko zakonodavstvo sa mogućnošću generisanja ugovora.

PRAVNA PITANJA - Odgovori KRATKO i DIREKTNO:
1. Koristi znanje iz srpskog zakonodavstva
2. Navedi konkretne kazne, iznose i rokove

FORMAT:
1. KRATAK odgovor
2. Nova linija: "Reference:"
3. U "Reference:" citiraj: Član X, Član Y, Član Z...

GENERISANJE UGOVORA:
Kada korisnik traži ugovor (npr. "Napravi ugovor o radu", "Treba mi ugovor o zakupu"):

1. PRIKUPI SVE podatke (za ugovor o radu: poslodavac, zaposleni, pozicija, zarada, datum, trajanje)
2. Kada imaš dovoljno informacija, generiši ugovor sa [CONTRACT_START] i [CONTRACT_END]:

[CONTRACT_START]
UGOVOR O RADU

Zaključen između:
1. [Poslodavac]
2. [Zaposleni]

Član 1. - PREDMET UGOVORA
[Detalji...]

[Ostali potrebni članovi...]

U _______, dana _______
Potpisi
[CONTRACT_END]

Nakon [CONTRACT_END] dodaj kratak komentar i preporuku za pravni pregled."#;
    
    messages.push(OpenRouterMessage {
        role: "system".to_string(),
        content: system_prompt.to_string(),
    });
    
    // Add recent conversation history
    for message in recent_messages {
        // For assistant messages, extract clean answer using proper parsing
        let content = if message.role == "assistant" {
            // Use parse_ai_response for proper parsing of stored responses
            match parse_ai_response(&message.content) {
                Ok(parsed) => parsed.answer, // Use only the clean answer part
                Err(_) => {
                    // Fallback to manual split for backward compatibility
                    message.content.split("Reference:").next()
                        .unwrap_or(&message.content)
                        .trim()
                        .to_string()
                }
            }
        } else {
            message.content.clone()
        };

        messages.push(OpenRouterMessage {
            role: message.role.clone(),
            content,
        });
    }
    
    // Add current question (combine with document content for LLM only)
    let user_content = if let Some(doc_content) = document_content {
        let combined = format!("{}\n\n[Uploaded Document]\n{}", current_question, doc_content);
        println!("🔍 Backend: Sending combined content to LLM: question='{}', doc_chars={}", current_question, doc_content.len());
        combined
    } else {
        println!("🔍 Backend: Sending question only to LLM: '{}'", current_question);
        current_question.to_string()
    };
    
    messages.push(OpenRouterMessage {
        role: "user".to_string(),
        content: user_content,
    });
    
    messages
}

async fn call_openrouter_api(
    api_key: &str, 
    messages: Vec<OpenRouterMessage>,
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
) -> Result<String, String> {
    // Calculate input text length for cost estimation
    let input_text: String = messages.iter()
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join(" ");
    let input_chars = input_text.len();
    
    let client = reqwest::Client::new();
    
    let request = OpenRouterRequest {
        model: "google/gemini-2.5-pro".to_string(),
        messages,
        temperature: 0.3,
    };

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API error: {}", error_text));
    }

    let openrouter_response: OpenRouterResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let response_content = openrouter_response
        .choices
        .first()
        .ok_or("No response from AI")?
        .message
        .content
        .clone();

    // Track LLM cost
    let output_chars = response_content.len();
    let estimated_cost = database::estimate_llm_cost(input_chars, output_chars);
    
    // Log cost tracking (don't fail the request if logging fails)
    if let Err(e) = database::track_llm_cost(user_id, device_fingerprint, estimated_cost, pool).await {
        eprintln!("Failed to track LLM cost: {}", e);
    }

    Ok(response_content)
}

fn parse_ai_response(response: &str) -> Result<QuestionResponse, String> {
    use regex::Regex;
    
    // Try to split by the explicit separator first
    let parts: Vec<&str> = response.split("Reference:")
        .collect();
    
    let (mut answer, law_quotes) = if parts.len() > 1 {
        let answer = parts[0].trim().to_string();
        let quotes_section = parts[1].trim();
        
        // DEBUG: Log the raw quotes section to see what LLM actually sent
        println!("🔍 DEBUG: Raw quotes section from LLM: '{}'", quotes_section);
        
        // Parse quotes from the dedicated section - preserve complete articles
        let quotes = extract_complete_articles_from_section(quotes_section);
            
        (answer, quotes)
    } else {
        // No explicit separation - extract articles from anywhere in the response
        let extracted_quotes = extract_quotes_from_text(response);
        
        // Clean the answer by removing extracted article references
        let mut clean_answer = response.to_string();
        
        // Remove bullet point articles
        let bullet_pattern = Regex::new(r"(?m)^\s*\*\s*\*\*[^*]*(?:Član|Stav)[^*]*\*\*[^\n]*\n?").unwrap();
        clean_answer = bullet_pattern.replace_all(&clean_answer, "").to_string();
        
        // Remove standalone bold articles  
        let bold_pattern = Regex::new(r"(?m)\*\*[^*]*(?:Član|Stav)[^*]*\*\*[^\n]*\n?").unwrap();
        clean_answer = bold_pattern.replace_all(&clean_answer, "").to_string();
        
        // Clean up extra whitespace
        clean_answer = clean_answer.trim().replace("\n\n\n", "\n\n").to_string();
        
        (clean_answer, extracted_quotes)
    };
    
    // Final cleanup of answer to remove any remaining scattered articles
    let article_inline_pattern = Regex::new(r"(?:^|\n)\s*(?:Član|Stav)\s+[^\n]*").unwrap();
    answer = article_inline_pattern.replace_all(&answer, "").to_string().trim().to_string();

    Ok(QuestionResponse {
        answer,
        law_quotes,
        law_name: None, // parse_ai_response doesn't have access to law_name (it's for parsing stored responses)
        generated_contract: None,
    })
}

fn extract_quotes_from_text(text: &str) -> Vec<String> {
    use regex::Regex;
    use std::collections::HashMap;
    
    let mut article_groups: HashMap<String, Vec<String>> = HashMap::new();
    
    // Pattern to match articles with paragraphs: "**Član X.** (1) content" or "**Clan X.** content"
    let article_pattern = Regex::new(r"(?m)\*\*([^*]*(?:Član|Stav)\s+(\d+)[^*]*)\*\*[:\s]*(.*)").unwrap();
    
    for cap in article_pattern.captures_iter(text) {
        let full_header = cap.get(1).unwrap().as_str().trim();
        let article_number = cap.get(2).unwrap().as_str();
        let content = cap.get(3).unwrap().as_str().trim();
        
        // Extract base article (e.g., "Član 212" from "Član 212. stav 1")
        let base_article = format!("Član {}", article_number);
        
        // Add content to the appropriate article group
        article_groups.entry(base_article.clone())
            .or_insert_with(Vec::new)
            .push(if content.is_empty() {
                full_header.to_string()
            } else {
                format!("{} {}", full_header, content)
            });
    }
    
    // If no structured articles found, try bullet points
    if article_groups.is_empty() {
        let bullet_pattern = Regex::new(r"(?m)^\s*\*\s*\*\*([^*]+)\*\*[:\s]*(.*)$").unwrap();
        for cap in bullet_pattern.captures_iter(text) {
            let header = cap.get(1).unwrap().as_str().trim();
            let content = cap.get(2).unwrap().as_str().trim();
            
            if header.contains("Član") || header.contains("Stav") {
                // Extract article number for grouping
                let article_num_pattern = Regex::new(r"Član\s+(\d+)").unwrap();
                if let Some(num_cap) = article_num_pattern.captures(header) {
                    let article_number = num_cap.get(1).unwrap().as_str();
                    let base_article = format!("Član {}", article_number);
                    
                    article_groups.entry(base_article)
                        .or_insert_with(Vec::new)
                        .push(if content.is_empty() {
                            format!("**{}**", header)
                        } else {
                            format!("**{}** {}", header, content)
                        });
                } else {
                    // Fallback for non-standard format
                    article_groups.entry(header.to_string())
                        .or_insert_with(Vec::new)
                        .push(if content.is_empty() {
                            format!("**{}**", header)
                        } else {
                            format!("**{}** {}", header, content)
                        });
                }
            }
        }
    }
    
    // Fallback: Line-by-line processing if still no matches
    if article_groups.is_empty() {
        let lines: Vec<&str> = text.lines().collect();
        let mut current_quote = String::new();
        let mut quotes = Vec::new();
        
        for line in lines {
            let line = line.trim();
            
            if line.contains("Član ") || line.contains("Stav ") || 
               line.contains("Tačka ") || line.contains("Paragraf ") {
                if !current_quote.is_empty() {
                    quotes.push(current_quote.trim().to_string());
                }
                current_quote = line.to_string();
            } else if !current_quote.is_empty() && !line.is_empty() {
                current_quote.push_str(" ");
                current_quote.push_str(line);
            }
        }
        
        if !current_quote.is_empty() {
            quotes.push(current_quote.trim().to_string());
        }
        
        return quotes;
    }
    
    // Convert grouped articles to final format
    let mut final_quotes = Vec::new();
    for (base_article, paragraphs) in article_groups {
        let combined_content = paragraphs.join("\n");
        final_quotes.push(format!("**{}**\n{}", base_article, combined_content));
    }
    
    final_quotes
}

// Speech-to-text transcription endpoint
#[derive(Debug, Serialize, Deserialize)]
pub struct TranscribeResponse {
    text: String,
}

pub async fn transcribe_audio_handler(
    State((pool, _openrouter_api_key, openai_api_key, jwt_secret)): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<ResponseJson<TranscribeResponse>, StatusCode> {
    println!("🎙️ ================== TRANSCRIPTION REQUEST ==================");
    
    // Extract user info for authorization
    let (user_id, device_fingerprint) = database::extract_user_info(&headers, &jwt_secret);
    println!("🔍 DEBUG: Transcription request - user_id: {:?}, device_fingerprint: {:?}", user_id, device_fingerprint);
    
    // Check if user can send message (same limits as regular messages)
    match database::can_send_message(user_id, device_fingerprint.clone(), &pool).await {
        Ok(can_send) => {
            if !can_send {
                println!("❌ DEBUG: User cannot send message - trial limit exceeded");
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
            println!("✅ DEBUG: User can use transcription");
        }
        Err(e) => {
            println!("❌ DEBUG: Error checking transcription limits: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    
    // Create multipart form data for OpenAI API
    let client = reqwest::Client::new();
    
    // Create form with audio file
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(body.to_vec())
            .file_name("recording.wav")
            .mime_str("audio/wav").unwrap())
        .text("model", "whisper-1")
        .text("language", "sr"); // Serbian language
    
    println!("🔍 DEBUG: Sending audio to Whisper API...");
    
    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", openai_api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            println!("❌ DEBUG: Whisper API request failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        println!("❌ DEBUG: Whisper API error: {}", error_text);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let whisper_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| {
            println!("❌ DEBUG: Failed to parse Whisper response: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let transcribed_text = whisper_response["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    println!("✅ DEBUG: Transcription successful: '{}'", transcribed_text);

    Ok(ResponseJson(TranscribeResponse {
        text: transcribed_text,
    }))
}

fn extract_complete_articles_from_section(text: &str) -> Vec<String> {
    // Split by **Član pattern to get complete article blocks
    let parts: Vec<&str> = text.split("**Član").collect();
    
    println!("🔍 DEBUG: Split into {} parts", parts.len());
    
    let mut articles = Vec::new();
    
    // Skip the first part (before any **Član) and process each article
    for (i, part) in parts.iter().skip(1).enumerate() {
        if part.trim().is_empty() {
            continue;
        }
        
        println!("🔍 DEBUG: Part {}: '{}'", i, part);
        
        // Reconstruct the complete article with **Član prefix
        let complete_article = format!("**Član{}", part).trim().to_string();
        
        println!("🔍 DEBUG: Reconstructed: '{}'", complete_article);
        
        if !complete_article.is_empty() {
            articles.push(complete_article);
        }
    }
    
    articles
}