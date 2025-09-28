import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from './Icons';
import './MessageBubble.css';

const MessageBubble = ({ message, isUser }) => {
  // Enhanced function to render markdown text
  const renderText = (text) => {
    if (!text) return text;
    
    return (
      <Markdown 
        remarkPlugins={[remarkGfm]}
        components={{
          // Prevent nested paragraphs in list items and quotes
          p: ({children}) => <span>{children}</span>,
        }}
      >
        {text}
      </Markdown>
    );
  };

  const extractCompleteArticles = (text) => {
    // Split by **Član pattern to get complete article blocks
    const parts = text.split(/\*\*Član/);
    
    const articles = [];
    
    // Skip the first part (before any **Član) and process each article
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part) {
        // Reconstruct the complete article with **Član prefix and add line break after header
        const completeArticle = `**Član ${part}`.replace(/(\*\*Član \d+[^*]*\*\*)/, '$1\n');
        articles.push(completeArticle);
      }
    }
    
    return articles;
  };

  const formatMessageContent = (content) => {
    if (isUser) {
      // User messages are now stored clean, no parsing needed
      // Check if message has document indicator
      if (message.has_document) {
        return (
          <div className="user-message-with-document">
            <div className="message-text">{content}</div>
            <div className="document-indicator">
              <Icon name="file" size={14} className="document-icon" />
              <span className="document-text">{message.document_filename || 'Document uploaded'}</span>
            </div>
          </div>
        );
      }
      return content;
    }

    // 🔍 DEBUG: Log raw LLM content
    console.log('🔍 RAW LLM CONTENT:', content);

    // First try explicit separation
    const parts = content.split(/Reference:|Citat iz zakona:|Pravni osnov:/i);
    console.log('🔍 EXPLICIT SEPARATOR FOUND:', parts.length > 1);
    
    if (parts.length > 1) {
      const answer = parts[0].trim();
      const quotesSection = parts.slice(1).join('\n\n').trim();
      
      // Extract complete articles preserving all content
      const quotes = extractCompleteArticles(quotesSection);
      
      return (
        <div className="ai-response">
          <div className="ai-answer">
            {renderText(answer)}
          </div>
          {quotes.length > 0 && (
            <div className="law-quotes">
              <div className="quotes-header">
                <span className="quotes-icon">
                  <Icon name="quote" size={16} />
                </span>
                {message.law_name || 'Reference:'}
              </div>
              <div className="quotes-content">
                {quotes.map((quote, index) => (
                  <div key={index} className="quote-item">
                    {renderText(quote.trim())}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    
    // Fallback: No explicit separation found, try to extract articles from content
    console.log('🔍 USING FALLBACK PATTERN MATCHING');
    const articleGroups = {};
    let cleanContent = content;
    
    // Pattern to match articles in bullet format: * **Član X.** content
    const articlePattern = /^\*\s*\*\*([^*]*(?:Član|Stav)\s+(\d+)[^*]*)\*\*[:\s]*([^\n]*)/gm;
    
    let match;
    const allMatches = [];
    while ((match = articlePattern.exec(content)) !== null) {
      allMatches.push({
        fullMatch: match[0],
        header: match[1],
        articleNumber: match[2],
        content: match[3]
      });
      const fullHeader = match[1].trim();
      const articleNumber = match[2];
      const articleContent = match[3] ? match[3].trim() : '';
      
      const baseArticle = `Član ${articleNumber}`;
      
      if (!articleGroups[baseArticle]) {
        articleGroups[baseArticle] = [];
      }
      
      const fullQuote = articleContent 
        ? `${fullHeader} ${articleContent}`
        : fullHeader;
        
      articleGroups[baseArticle].push(fullQuote);
      
      // Remove this article from main content
      cleanContent = cleanContent.replace(match[0], '');
    }
    
    console.log('🔍 FALLBACK PATTERN MATCHES:', allMatches);
    console.log('🔍 ARTICLE GROUPS:', articleGroups);
    
    // Convert grouped articles to final quotes
    const extractedQuotes = [];
    for (const [baseArticle, paragraphs] of Object.entries(articleGroups)) {
      const combinedContent = paragraphs.join('\n');
      extractedQuotes.push(`**${baseArticle}**\n${combinedContent}`);
    }
    
    console.log('🔍 FINAL EXTRACTED QUOTES:', extractedQuotes);
    
    if (extractedQuotes.length > 0) {
      // Clean up the main content
      cleanContent = cleanContent
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive line breaks
        .trim();
        
      return (
        <div className="ai-response">
          <div className="ai-answer">
            {renderText(cleanContent)}
          </div>
          <div className="law-quotes">
            <div className="quotes-header">
              <span className="quotes-icon">
                <Icon name="quote" size={16} />
              </span>
              {message.law_name || 'Reference:'}
            </div>
            <div className="quotes-content">
              {extractedQuotes.map((quote, index) => (
                <div key={index} className="quote-item">
                  {renderText(quote)}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    
    return renderText(content);
  };


  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-content">
        {formatMessageContent(message.content)}
      </div>
    </div>
  );
};

export default MessageBubble;