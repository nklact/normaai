# Contract Generation Feature - Backend Implementation Guide

This document describes the backend changes needed to support interactive contract generation in Norma AI.

## Overview

The contract generation feature allows users to generate customized legal contracts through an interactive conversational flow. The LLM naturally guides users through gathering requirements and generates contracts in .docx format.

## Frontend Changes (Already Implemented)

✅ ContractDownloadButton component created
✅ MessageBubble updated to display contract download buttons
✅ App.jsx updated to handle `generated_contract` metadata
✅ Icon set extended with alert icon

## Backend Changes Required

### 1. Enhanced System Prompt

**File**: Your LLM system prompt configuration

**Changes**:
Add contract generation capabilities to the system prompt:

```
You are Norma AI, a legal assistant for Serbian law with contract generation capabilities.

When users request contract generation:
1. Identify the contract type needed (employment, service, rental, loan, etc.)
2. Ask clarifying questions to gather ALL required information
3. When you have sufficient information, generate the complete contract
4. Use proper legal language and Serbian legal format
5. Include all standard clauses and necessary sections

To indicate a generated contract, wrap it with special markers:
[CONTRACT_START]
<contract content in plain text>
[CONTRACT_END]

After the contract markers, provide a brief summary explaining what was generated.
```

### 2. Update `/api/question` Endpoint

**Current Request Format**:
```javascript
{
  "question": string,
  "document_content": string | null,
  "document_filename": string | null,
  "chat_id": number,
  "device_fingerprint": string
}
```

**Current Response Format**:
```javascript
{
  "answer": string,
  "law_quotes": string[],
  "law_name": string
}
```

**NEW Response Format** (when contract is generated):
```javascript
{
  "answer": string,              // Response without contract content
  "law_quotes": string[],
  "law_name": string,
  // NEW FIELD:
  "generated_contract": {
    "filename": string,          // e.g., "Ugovor_o_radu_2025-10-12.docx"
    "download_url": string,      // Temporary download URL
    "contract_type": string,     // e.g., "Ugovor o radu"
    "preview_text": string       // First 200 chars for preview
  } | null
}
```

### 3. Contract Detection and Processing

**Implementation Steps**:

#### Step 3.1: Detect Contract in LLM Response

```python
def detect_contract(llm_response: str) -> tuple[bool, str, str]:
    """
    Detect if LLM response contains a generated contract.

    Returns:
        (has_contract, contract_content, clean_response)
    """
    start_marker = "[CONTRACT_START]"
    end_marker = "[CONTRACT_END]"

    if start_marker in llm_response and end_marker in llm_response:
        start_idx = llm_response.index(start_marker) + len(start_marker)
        end_idx = llm_response.index(end_marker)

        contract_content = llm_response[start_idx:end_idx].strip()

        # Remove contract markers from response
        clean_response = (
            llm_response[:llm_response.index(start_marker)] +
            llm_response[end_idx + len(end_marker):]
        ).strip()

        return True, contract_content, clean_response

    return False, "", llm_response
```

#### Step 3.2: Generate .docx File

**Required Library**: `python-docx` (Python) or `docxtemplater` (Node.js)

```python
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
import uuid
import os

def generate_docx(contract_content: str, contract_type: str) -> str:
    """
    Generate .docx file from contract content.

    Returns:
        file_id: Unique identifier for the generated file
    """
    doc = Document()

    # Add title
    title = doc.add_heading(contract_type, 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Add contract content
    # Split by paragraphs and add them
    paragraphs = contract_content.split('\n\n')
    for para_text in paragraphs:
        if para_text.strip():
            para = doc.add_paragraph(para_text.strip())
            para.style.font.size = Pt(12)
            para.style.font.name = 'Times New Roman'

    # Generate unique file ID
    file_id = str(uuid.uuid4())

    # Save to temporary storage
    temp_dir = "/tmp/contracts"  # Or your temp directory
    os.makedirs(temp_dir, exist_ok=True)

    filename = f"{file_id}.docx"
    filepath = os.path.join(temp_dir, filename)
    doc.save(filepath)

    return file_id, filepath
```

#### Step 3.3: Create Download Endpoint

**New Endpoint**: `GET /api/contracts/:file_id`

```python
@app.route('/api/contracts/<file_id>')
def download_contract(file_id):
    """
    Serve generated contract file for download.
    """
    # Validate file_id format
    if not is_valid_uuid(file_id):
        return {"error": "Invalid file ID"}, 400

    # Get file path
    filepath = os.path.join("/tmp/contracts", f"{file_id}.docx")

    # Check if file exists
    if not os.path.exists(filepath):
        return {"error": "File not found or expired"}, 404

    # Send file
    return send_file(
        filepath,
        mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        as_attachment=True,
        download_name=get_friendly_filename(file_id)
    )
```

#### Step 3.4: Update Main Question Handler

```python
@app.route('/api/question', methods=['POST'])
def ask_question():
    data = request.json
    question = data.get('question')
    chat_id = data.get('chat_id')

    # Get LLM response
    llm_response = get_llm_response(question, chat_id)

    # Check for contract generation
    has_contract, contract_content, clean_response = detect_contract(llm_response)

    response_data = {
        "answer": clean_response,
        "law_quotes": extract_law_quotes(clean_response),
        "law_name": extract_law_name(clean_response),
        "generated_contract": None
    }

    # If contract was generated, create file
    if has_contract:
        contract_type = detect_contract_type(contract_content)
        file_id, filepath = generate_docx(contract_content, contract_type)

        # Schedule file cleanup after 24 hours
        schedule_cleanup(filepath, hours=24)

        # Get preview text
        preview_text = contract_content[:200] + "..." if len(contract_content) > 200 else contract_content

        # Build download URL
        download_url = f"{API_BASE_URL}/api/contracts/{file_id}"

        # Create friendly filename
        timestamp = datetime.now().strftime("%Y-%m-%d")
        filename = f"{contract_type.replace(' ', '_')}_{timestamp}.docx"

        response_data["generated_contract"] = {
            "filename": filename,
            "download_url": download_url,
            "contract_type": contract_type,
            "preview_text": preview_text
        }

    return jsonify(response_data)
```

### 4. Contract Type Detection

```python
def detect_contract_type(contract_content: str) -> str:
    """
    Detect the type of contract from its content.
    """
    content_lower = contract_content.lower()

    # Common Serbian contract types
    contract_types = {
        "ugovor o radu": ["zaposleni", "poslodavac", "radno mesto", "zarada"],
        "ugovor o delu": ["izvršilac", "nalogodavac", "delo"],
        "ugovor o zakupu": ["zakupodavac", "zakupac", "zakupnina"],
        "ugovor o zajmu": ["zajmodavac", "zajmoprimac", "kamata"],
        "ugovor o pozajmici": ["pozajmilac", "pozajmoprimac"],
    }

    # Score each contract type
    scores = {}
    for contract_type, keywords in contract_types.items():
        score = sum(1 for keyword in keywords if keyword in content_lower)
        scores[contract_type] = score

    # Return type with highest score
    best_match = max(scores.items(), key=lambda x: x[1])

    # If no clear match, extract from first line
    if best_match[1] == 0:
        first_line = contract_content.split('\n')[0].strip()
        if 'ugovor' in first_line.lower():
            return first_line
        return "Ugovor"

    return best_match[0].title()
```

### 5. File Cleanup

```python
import schedule
import time
from datetime import datetime, timedelta

def schedule_cleanup(filepath: str, hours: int = 24):
    """
    Schedule file deletion after specified hours.
    """
    cleanup_time = datetime.now() + timedelta(hours=hours)

    # Store in database or queue
    add_to_cleanup_queue(filepath, cleanup_time)

def cleanup_expired_files():
    """
    Run periodically to delete expired contract files.
    """
    expired_files = get_expired_files_from_queue()

    for filepath in expired_files:
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
            remove_from_cleanup_queue(filepath)
        except Exception as e:
            print(f"Error cleaning up {filepath}: {e}")
```

### 6. Database Schema Updates (Optional)

If you want to persist contract generation history:

```sql
-- Add column to messages table
ALTER TABLE messages ADD COLUMN contract_file_id VARCHAR(255);
ALTER TABLE messages ADD COLUMN contract_type VARCHAR(255);
ALTER TABLE messages ADD COLUMN contract_filename VARCHAR(500);

-- Create contracts table
CREATE TABLE generated_contracts (
    id SERIAL PRIMARY KEY,
    file_id VARCHAR(255) UNIQUE NOT NULL,
    message_id INTEGER REFERENCES messages(id),
    contract_type VARCHAR(255),
    filename VARCHAR(500),
    filepath VARCHAR(1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    downloaded_count INTEGER DEFAULT 0
);
```

### 7. Plan-Based Access Control

Implement access control based on user plan:

```python
def check_contract_generation_access(user_status: dict) -> tuple[bool, str]:
    """
    Check if user has access to contract generation.

    Returns:
        (has_access, error_message)
    """
    access_type = user_status.get('access_type')

    # Trial users: No access
    if access_type in ['trial_unregistered', 'trial_registered']:
        return False, "Contract generation requires at least Individual plan"

    # Individual users: Limited access (5 per month)
    if access_type == 'individual':
        contracts_this_month = get_contracts_count_this_month(user_status['user_id'])
        if contracts_this_month >= 5:
            return False, "Monthly contract generation limit reached (5/month on Individual plan)"
        return True, ""

    # Professional, Team, Premium: Unlimited
    if access_type in ['professional', 'team', 'premium']:
        return True, ""

    return False, "Unknown plan type"
```

### 8. Security Considerations

**Important Security Measures**:

1. **File ID Validation**: Always validate UUIDs to prevent directory traversal
```python
import uuid

def is_valid_uuid(val):
    try:
        uuid.UUID(str(val))
        return True
    except ValueError:
        return False
```

2. **Rate Limiting**: Limit contract generation requests per user
```python
from flask_limiter import Limiter

limiter = Limiter(key_func=get_user_id)

@app.route('/api/question')
@limiter.limit("10 per hour")  # Adjust based on plan
def ask_question():
    # ... handler code
```

3. **File Size Limits**: Limit generated contract file sizes
4. **Temporary Storage**: Store files in temporary location with automatic cleanup
5. **CORS**: Ensure download endpoint allows requests from your frontend domain

### 9. Testing

**Test Cases**:

1. **Basic Contract Generation**:
   - User requests: "Trebam ugovor o radu"
   - LLM asks clarifying questions
   - LLM generates contract with [CONTRACT_START/END] markers
   - Backend creates .docx file
   - Frontend displays download button

2. **Multi-turn Conversation**:
   - User provides information over multiple messages
   - Context is maintained across turns
   - Contract generated after sufficient information gathered

3. **Plan-Based Access**:
   - Trial user blocked from generating contracts
   - Individual user limited to 5 contracts/month
   - Professional user has unlimited access

4. **File Download**:
   - Generated file downloads correctly
   - Filename is user-friendly
   - File content matches LLM output

5. **File Cleanup**:
   - Files auto-deleted after 24 hours
   - Database records updated correctly

### 10. Example LLM Interaction Flow

**Turn 1**:
```
User: "Trebam ugovor o radu za novog zaposlenog"
LLM: "Pomoći ću vam da napravite ugovor o radu. Potrebni su mi sledeći podaci:
      1. Ime i adresa poslodavca?
      2. Ime zaposlenog i pozicija?
      3. Neto zarada?
      4. Datum početka rada?
      5. Da li je ugovor na određeno ili neodređeno vreme?"
```

**Turn 2**:
```
User: "Poslodavac: Tech DOO, Beograd. Zaposleni: Marko Marković, Software Developer.
       Zarada: 150,000 RSD. Početak: 01.11.2025. Neodređeno vreme."

LLM: "Odlično! Napravila sam ugovor o radu sa svim potrebnim podacima.

[CONTRACT_START]
UGOVOR O RADU NA NEODREĐENO VREME

Zaključen dana _____________ između:

1. TECH DOO, sa sedištem u Beogradu
(u daljem tekstu: Poslodavac)

i

2. Marko Marković, sa prebivalištem u ____________
(u daljem tekstu: Zaposleni)

Član 1.
Poslodavac zaključuje sa Zaposlenim ugovor o radu na neodređeno vreme...

[... full contract content ...]

[CONTRACT_END]

Ugovor je spreman za preuzimanje. Sadrži sve standardne klauzule prema Zakonu o radu
Republike Srbije. Pre potpisa, preporučujem da ugovor pregleda pravnik."
```

**Backend Processing**:
```python
# Backend detects [CONTRACT_START/END] markers
has_contract = True
contract_content = "UGOVOR O RADU NA NEODREĐENO VREME\n\n..."

# Generate .docx file
file_id = generate_docx(contract_content, "Ugovor o radu")

# Return response with contract metadata
{
  "answer": "Odlično! Napravila sam ugovor o radu...\n\nUgovor je spreman...",
  "law_quotes": [],
  "law_name": null,
  "generated_contract": {
    "filename": "Ugovor_o_radu_2025-10-12.docx",
    "download_url": "https://norma-ai.fly.dev/api/contracts/abc-123-def",
    "contract_type": "Ugovor o radu",
    "preview_text": "UGOVOR O RADU NA NEODREĐENO VREME\n\nZaključen dana..."
  }
}
```

**Frontend Display**:
- Shows LLM's response text
- Displays purple download button with contract icon
- User clicks → downloads .docx file

## Implementation Checklist

- [ ] Update LLM system prompt with contract generation instructions
- [ ] Implement contract detection in LLM responses
- [ ] Add document generation library (python-docx or docxtemplater)
- [ ] Create .docx generation function
- [ ] Add `/api/contracts/:file_id` download endpoint
- [ ] Update `/api/question` endpoint to handle generated_contract field
- [ ] Implement file cleanup scheduler
- [ ] Add plan-based access control
- [ ] Update database schema (optional)
- [ ] Add security measures (UUID validation, rate limiting)
- [ ] Write tests for contract generation flow
- [ ] Test with various contract types
- [ ] Monitor LLM token usage (contract generation uses more tokens)

## Deployment Notes

1. **Environment Variables**:
   ```
   CONTRACTS_TEMP_DIR=/tmp/contracts
   CONTRACTS_EXPIRY_HOURS=24
   API_BASE_URL=https://norma-ai.fly.dev
   ```

2. **Disk Space**: Monitor temporary directory for disk usage
3. **Backup**: Consider backing up generated contracts for 30 days
4. **Monitoring**: Track contract generation success/failure rates
5. **Costs**: Monitor LLM API costs (longer context for conversations)

## Future Enhancements

1. **Contract Templates**: Pre-built templates for common contracts
2. **PDF Generation**: Option to generate PDF instead of DOCX
3. **E-Signature Integration**: Integrate DocuSign or similar
4. **Contract Review**: AI-powered review of uploaded contracts
5. **Version History**: Track contract iterations
6. **Email Delivery**: Email generated contracts directly to users

## Support

For questions or issues during implementation, contact the frontend team or refer to:
- Frontend implementation in `src/components/ContractDownloadButton.jsx`
- API handling in `src/App.jsx` (lines 525-526)
- Message display in `src/components/MessageBubble.jsx` (lines 95-97, 190-192)
