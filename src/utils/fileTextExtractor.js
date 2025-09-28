import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// Supported file types
export const SUPPORTED_FILE_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'text/plain': 'TXT',
  'text/rtf': 'RTF',
  'application/rtf': 'RTF'
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Text processing configuration for ChatGPT-style handling
const CHUNK_SIZE = 4000; // Characters per chunk (within token limits)
const CHUNK_OVERLAP = 200; // Character overlap between chunks
const MAX_TOTAL_CHUNKS = 10; // Maximum chunks to prevent overwhelming

/**
 * Check if file type is supported
 */
export function isFileTypeSupported(file) {
  return Object.keys(SUPPORTED_FILE_TYPES).includes(file.type);
}

/**
 * Check if file size is within limits
 */
export function isFileSizeValid(file) {
  return file.size <= MAX_FILE_SIZE;
}

/**
 * Extract text from PDF file
 */
async function extractTextFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    const numPages = pdf.numPages;
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
        .replace(/\s+/g, ' '); // Normalize whitespace
      
      fullText += pageText + '\n\n';
    }
    
    return fullText.trim();
  } catch (error) {
    throw new Error(`PDF processing error: ${error.message}`);
  }
}

/**
 * Extract text from DOCX file
 */
async function extractTextFromDOCX(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    
    if (result.messages && result.messages.length > 0) {
      console.warn('DOCX conversion warnings:', result.messages);
    }
    
    return result.value.trim();
  } catch (error) {
    throw new Error(`DOCX processing error: ${error.message}`);
  }
}

/**
 * Extract text from plain text files
 */
async function extractTextFromPlainText(file) {
  try {
    const text = await file.text();
    return text.trim();
  } catch (error) {
    throw new Error(`Text file processing error: ${error.message}`);
  }
}

/**
 * Extract text from RTF file (basic implementation)
 */
async function extractTextFromRTF(file) {
  try {
    const text = await file.text();
    
    // Basic RTF text extraction - remove RTF control codes
    const cleanText = text
      .replace(/\\[a-z]+\d*\s?/g, '') // Remove RTF commands
      .replace(/[{}]/g, '') // Remove braces
      .replace(/\\\\/g, '\\') // Unescape backslashes
      .replace(/\\'/g, "'") // Unescape quotes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    return cleanText;
  } catch (error) {
    throw new Error(`RTF processing error: ${error.message}`);
  }
}

/**
 * Intelligently chunk long text for processing
 */
function chunkText(text, userQuestion = '') {
  if (text.length <= CHUNK_SIZE) {
    return [text]; // No chunking needed
  }
  
  const chunks = [];
  let currentPosition = 0;
  
  // Try to split by paragraphs first, then by sentences, then by character
  while (currentPosition < text.length && chunks.length < MAX_TOTAL_CHUNKS) {
    let chunkEnd = Math.min(currentPosition + CHUNK_SIZE, text.length);
    
    if (chunkEnd < text.length) {
      // Try to find a good breaking point
      const substringToCheck = text.substring(currentPosition, chunkEnd + 500);
      
      // Look for paragraph break
      let breakPoint = substringToCheck.lastIndexOf('\n\n');
      if (breakPoint === -1 || breakPoint < CHUNK_SIZE * 0.7) {
        // Look for sentence break
        breakPoint = substringToCheck.lastIndexOf('. ');
        if (breakPoint === -1 || breakPoint < CHUNK_SIZE * 0.5) {
          // Look for any sentence ending
          breakPoint = substringToCheck.lastIndexOf('.');
          if (breakPoint === -1 || breakPoint < CHUNK_SIZE * 0.3) {
            // Force break at word boundary
            breakPoint = substringToCheck.lastIndexOf(' ');
            if (breakPoint === -1) {
              breakPoint = CHUNK_SIZE;
            }
          }
        }
      }
      
      chunkEnd = currentPosition + Math.min(breakPoint + 1, CHUNK_SIZE);
    }
    
    let chunk = text.substring(currentPosition, chunkEnd).trim();
    
    // Add context for middle and end chunks
    if (chunks.length === 0) {
      chunk = `Document start:\n\n${chunk}`;
    } else if (chunkEnd >= text.length) {
      chunk = `Document end:\n\n${chunk}`;
    } else {
      chunk = `Document section ${chunks.length + 1}:\n\n${chunk}`;
    }
    
    chunks.push(chunk);
    currentPosition = chunkEnd - CHUNK_OVERLAP;
  }
  
  return chunks;
}

/**
 * Main function to extract text from any supported file
 */
export async function extractTextFromFile(file, onProgress) {
  // Validate file type
  if (!isFileTypeSupported(file)) {
    const supportedTypes = Object.values(SUPPORTED_FILE_TYPES).join(', ');
    throw new Error(`Nepodržan tip fajla. Podržani tipovi: ${supportedTypes}`);
  }
  
  // Validate file size
  if (!isFileSizeValid(file)) {
    const maxSizeMB = Math.round(MAX_FILE_SIZE / (1024 * 1024));
    throw new Error(`Fajl je prevelik. Maksimalna veličina: ${maxSizeMB}MB`);
  }
  
  if (onProgress) onProgress(10);
  
  try {
    let extractedText = '';
    
    if (onProgress) onProgress(30);
    
    switch (file.type) {
      case 'application/pdf':
        extractedText = await extractTextFromPDF(file);
        break;
        
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        extractedText = await extractTextFromDOCX(file);
        break;
        
      case 'application/msword':
        // DOC files are not directly supported by mammoth, but we'll try
        throw new Error('DOC fajlovi nisu podržani. Molimo sačuvajte kao DOCX format.');
        
      case 'text/plain':
        extractedText = await extractTextFromPlainText(file);
        break;
        
      case 'text/rtf':
      case 'application/rtf':
        extractedText = await extractTextFromRTF(file);
        break;
        
      default:
        throw new Error('Nepodržan tip fajla');
    }
    
    if (onProgress) onProgress(90);
    
    if (!extractedText || extractedText.length === 0) {
      throw new Error('Nije moguće izvući tekst iz fajla. Fajl je možda prazan ili oštećen.');
    }
    
    if (onProgress) onProgress(100);
    
    return extractedText;
    
  } catch (error) {
    console.error('File text extraction error:', error);
    throw error;
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Get file type display name
 */
export function getFileTypeDisplayName(file) {
  return SUPPORTED_FILE_TYPES[file.type] || file.type;
}

/**
 * Process extracted text with intelligent chunking for large documents
 */
export function processExtractedText(text, userQuestion = '') {
  if (text.length <= CHUNK_SIZE) {
    return {
      processedText: text,
      isChunked: false,
      totalChunks: 1,
      originalLength: text.length
    };
  }
  
  const chunks = chunkText(text, userQuestion);
  
  // Create a summary with document structure
  const summary = `This document has been processed in ${chunks.length} sections due to its length (${text.length} characters). ` +
    `The content will be analyzed comprehensively across all sections.\n\n`;
  
  // Combine chunks with clear separators
  const processedText = summary + chunks.join('\n\n--- SECTION BREAK ---\n\n');
  
  return {
    processedText,
    isChunked: true,
    totalChunks: chunks.length,
    originalLength: text.length,
    chunks: chunks
  };
}