use crate::models::GeneratedContract;
use axum::{
    extract::Path,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use docx_rs::*;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const CONTRACTS_DIR: &str = "/tmp/contracts";
const CONTRACTS_EXPIRY_HOURS: i64 = 720; // 30 days

/// Detect if LLM response contains a generated contract
pub fn detect_contract(llm_response: &str) -> Option<(String, String)> {
    const START_MARKER: &str = "[CONTRACT_START]";
    const END_MARKER: &str = "[CONTRACT_END]";

    if !llm_response.contains(START_MARKER) || !llm_response.contains(END_MARKER) {
        return None;
    }

    let start_idx = llm_response.find(START_MARKER)? + START_MARKER.len();
    let end_idx = llm_response.find(END_MARKER)?;

    if start_idx >= end_idx {
        return None;
    }

    let contract_content = llm_response[start_idx..end_idx].trim().to_string();

    // Remove contract markers from response to get clean answer
    let clean_response = format!(
        "{}{}",
        &llm_response[..llm_response.find(START_MARKER)?],
        &llm_response[end_idx + END_MARKER.len()..]
    )
    .trim()
    .to_string();

    // Validate contract has reasonable content
    if contract_content.len() < 100 || !contract_content.to_lowercase().contains("ugovor") {
        return None;
    }

    Some((contract_content, clean_response))
}

/// Generate contract file and return metadata
pub fn generate_contract_file(
    contract_content: &str,
    api_base_url: &str,
) -> Result<GeneratedContract, String> {
    // Ensure contracts directory exists
    fs::create_dir_all(CONTRACTS_DIR)
        .map_err(|e| format!("Failed to create contracts directory: {}", e))?;

    // Generate unique file ID
    let file_id = Uuid::new_v4();

    // Detect contract type from first line
    let contract_type = detect_contract_type(contract_content);

    // Create filename
    let timestamp = Utc::now().format("%Y-%m-%d");
    let safe_type = contract_type.replace(" ", "_").replace("/", "-");
    let filename = format!("{}_{}.docx", safe_type, timestamp);

    // Write contract to file as Word document
    let filepath = PathBuf::from(CONTRACTS_DIR).join(format!("{}.docx", file_id));

    // Create Word document with proper formatting
    create_word_document(&filepath, contract_content, &contract_type)
        .map_err(|e| format!("Failed to create Word document: {}", e))?;

    // Generate preview text
    let preview_text = get_preview_text(contract_content);

    // Build download URL
    let download_url = format!("{}/api/contracts/{}", api_base_url, file_id);

    println!(
        "✅ Generated contract: {} -> {}",
        contract_type,
        filepath.display()
    );

    Ok(GeneratedContract {
        filename,
        download_url,
        contract_type,
        preview_text,
        created_at: Utc::now(),
    })
}

/// Detect contract type from content
fn detect_contract_type(content: &str) -> String {
    // Get first non-empty line
    let first_line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Ugovor")
        .trim()
        .to_string();

    // If it looks like a title, use it
    if first_line.to_lowercase().contains("ugovor") && first_line.len() < 100 {
        first_line
    } else {
        "Ugovor".to_string()
    }
}

/// Get preview text from contract
fn get_preview_text(content: &str) -> String {
    const MAX_LENGTH: usize = 200;

    if content.len() <= MAX_LENGTH {
        content.to_string()
    } else {
        format!("{}...", &content[..MAX_LENGTH])
    }
}

/// Parse markdown bold syntax (**text**) into text segments with bold flags
fn parse_markdown_bold(text: &str) -> Vec<(String, bool)> {
    let mut segments = Vec::new();
    let mut current_text = String::new();
    let mut chars = text.chars().peekable();
    let mut is_bold = false;

    while let Some(ch) = chars.next() {
        if ch == '*' && chars.peek() == Some(&'*') {
            // Found ** marker
            chars.next(); // consume second *

            // Save current segment if any
            if !current_text.is_empty() {
                segments.push((current_text.clone(), is_bold));
                current_text.clear();
            }

            // Toggle bold state
            is_bold = !is_bold;
        } else {
            current_text.push(ch);
        }
    }

    // Add remaining text
    if !current_text.is_empty() {
        segments.push((current_text, is_bold));
    }

    segments
}

/// Create Word document with proper formatting
fn create_word_document(
    filepath: &PathBuf,
    content: &str,
    contract_type: &str,
) -> Result<(), String> {
    let timestamp = Utc::now().format("%d.%m.%Y.");

    // Create new Word document
    let mut docx = Docx::new();

    // Parse and add title (contract type) - Bold, size 16, centered
    // Strip markdown markers from title since we're applying bold anyway
    let clean_title = contract_type.replace("**", "");
    let title = Paragraph::new()
        .add_run(
            Run::new()
                .add_text(&clean_title)
                .size(32) // Size is in half-points (16pt = 32)
                .bold(),
        )
        .align(AlignmentType::Center);
    docx = docx.add_paragraph(title);

    // Add empty line
    docx = docx.add_paragraph(Paragraph::new());

    // Add contract content - parse and format each line
    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            // Empty line
            docx = docx.add_paragraph(Paragraph::new());
        } else if trimmed.starts_with("Član") || trimmed.starts_with("ČLAN") {
            // Article heading - parse markdown and make bold
            let segments = parse_markdown_bold(trimmed);
            let mut para = Paragraph::new();
            for (text, is_bold) in segments {
                let mut run = Run::new().add_text(&text).size(22); // 11pt
                if is_bold {
                    run = run.bold();
                }
                para = para.add_run(run);
            }
            docx = docx.add_paragraph(para);
        } else if trimmed
            .chars()
            .all(|c| c.is_uppercase() || c.is_whitespace() || c == '-' || c == '_')
            && trimmed.len() > 5
        {
            // All caps lines (section headings) - parse markdown and make bold
            let segments = parse_markdown_bold(trimmed);
            let mut para = Paragraph::new();
            for (text, is_bold) in segments {
                let mut run = Run::new().add_text(&text).size(22); // 11pt
                if is_bold {
                    run = run.bold();
                }
                para = para.add_run(run);
            }
            docx = docx.add_paragraph(para);
        } else {
            // Regular text - parse markdown for inline bold
            let segments = parse_markdown_bold(trimmed);
            let mut para = Paragraph::new();
            for (text, is_bold) in segments {
                let mut run = Run::new().add_text(&text).size(22); // 11pt
                if is_bold {
                    run = run.bold();
                }
                para = para.add_run(run);
            }
            docx = docx.add_paragraph(para);
        }
    }

    // Add separator
    docx = docx.add_paragraph(Paragraph::new());
    let separator = Paragraph::new().add_run(
        Run::new()
            .add_text("═══════════════════════════════════════════════════════════════════")
            .size(22), // 11pt
    );
    docx = docx.add_paragraph(separator);

    // Add footer info
    docx = docx.add_paragraph(Paragraph::new());

    let footer1 = Paragraph::new().add_run(
        Run::new()
            .add_text("Generisano uz pomoć Norma AI")
            .italic()
            .size(22), // 11pt
    );
    docx = docx.add_paragraph(footer1);

    let footer2 = Paragraph::new().add_run(
        Run::new()
            .add_text(&format!("Datum generisanja: {}", timestamp))
            .italic()
            .size(22), // 11pt
    );
    docx = docx.add_paragraph(footer2);

    docx = docx.add_paragraph(Paragraph::new());

    let footer3 = Paragraph::new().add_run(
        Run::new()
            .add_text("NAPOMENA: Ovaj ugovor je generisan automatski i služi kao primer.")
            .italic()
            .size(22), // 11pt
    );
    docx = docx.add_paragraph(footer3);

    let footer4 = Paragraph::new().add_run(
        Run::new()
            .add_text("Preporučujemo konsultaciju sa pravnikom pre potpisivanja.")
            .italic()
            .size(22), // 11pt
    );
    docx = docx.add_paragraph(footer4);

    // Write to file
    let file =
        std::fs::File::create(filepath).map_err(|e| format!("Failed to create file: {}", e))?;

    docx.build()
        .pack(file)
        .map_err(|e| format!("Failed to write Word document: {}", e))?;

    Ok(())
}

/// Get contract file path
pub fn get_contract_path(file_id: Uuid) -> PathBuf {
    PathBuf::from(CONTRACTS_DIR).join(format!("{}.docx", file_id))
}

/// Check if contract file exists
pub fn contract_exists(file_id: Uuid) -> bool {
    get_contract_path(file_id).exists()
}

/// Download contract endpoint handler
pub async fn download_contract_handler(
    Path(file_id): Path<String>,
) -> Result<Response, StatusCode> {
    println!("📥 Contract download request: {}", file_id);

    // Parse UUID
    let file_uuid = Uuid::parse_str(&file_id).map_err(|_| {
        println!("❌ Invalid UUID format: {}", file_id);
        StatusCode::BAD_REQUEST
    })?;

    // Check if file exists
    if !contract_exists(file_uuid) {
        println!("❌ Contract not found: {}", file_id);
        return Err(StatusCode::NOT_FOUND);
    }

    // Read file
    let filepath = get_contract_path(file_uuid);
    let content = fs::read(&filepath).map_err(|e| {
        println!("❌ Failed to read contract file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    println!("✅ Serving contract: {} ({} bytes)", file_id, content.len());

    // Return file with appropriate headers for Word document
    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            (
                header::CONTENT_DISPOSITION,
                &format!("attachment; filename=\"Ugovor_{}.docx\"", &file_id[..8]),
            ),
        ],
        content,
    )
        .into_response())
}

/// Clean up old contract files (call periodically or on startup)
pub fn cleanup_old_contracts() -> Result<usize, String> {
    let dir = PathBuf::from(CONTRACTS_DIR);

    if !dir.exists() {
        return Ok(0);
    }

    let now = Utc::now();
    let mut deleted_count = 0;

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read contracts directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        // Check file age
        if let Ok(metadata) = fs::metadata(&path) {
            if let Ok(created) = metadata.created() {
                let created_time = chrono::DateTime::<Utc>::from(created);
                let age_hours = (now - created_time).num_hours();

                if age_hours >= CONTRACTS_EXPIRY_HOURS {
                    if fs::remove_file(&path).is_ok() {
                        deleted_count += 1;
                        println!("🗑️  Deleted expired contract: {:?}", path);
                    }
                }
            }
        }
    }

    if deleted_count > 0 {
        println!("✅ Cleaned up {} expired contract(s)", deleted_count);
    }

    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_contract() {
        let response = r#"
        Odlično! Napravila sam ugovor.

        [CONTRACT_START]
        UGOVOR O RADU

        Zaključen između...
        [CONTRACT_END]

        Ugovor je spreman.
        "#;

        let result = detect_contract(response);
        assert!(result.is_some());

        let (contract, clean) = result.unwrap();
        assert!(contract.contains("UGOVOR O RADU"));
        assert!(!clean.contains("[CONTRACT_START]"));
    }

    #[test]
    fn test_detect_contract_type() {
        let content = "UGOVOR O RADU NA NEODREĐENO VREME\n\nZaključen...";
        let contract_type = detect_contract_type(content);
        assert_eq!(contract_type, "UGOVOR O RADU NA NEODREĐENO VREME");
    }
}
