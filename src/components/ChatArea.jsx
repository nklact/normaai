import React, { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import Icon from './Icons';
import TemplateLibraryModal from './TemplateLibraryModal';
import './ChatArea.css';
import { extractTextFromFile, processExtractedText, isFileTypeSupported, isFileSizeValid, formatFileSize, getFileTypeDisplayName } from '../utils/fileTextExtractor';

const ChatArea = ({ messages, onSendMessage, isLoading, currentChatId, userStatus, onOpenPlanSelection, onOpenAuthModal, isAuthenticated }) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // File upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [fileProcessingProgress, setFileProcessingProgress] = useState(0);
  
  // Speech-to-text state
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Template library modal state
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);

  const scrollToLatestMessage = () => {
    // Use longer delay for Safari mobile compatibility and rendering
    setTimeout(() => {
      if (messages.length === 0) return;

      const messagesContainer = messagesEndRef.current?.parentElement;
      // Get the last message element (most recent user or assistant message)
      const lastMessageElement = messagesContainer?.children[messages.length - 1];

      if (lastMessageElement && messagesContainer) {
        // Safari mobile compatibility: use manual scroll calculation
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const isMobile = window.innerWidth <= 768;

        if (isSafari && isMobile) {
          // Manual scroll for Safari mobile
          const containerRect = messagesContainer.getBoundingClientRect();
          const elementRect = lastMessageElement.getBoundingClientRect();
          const scrollTop = messagesContainer.scrollTop + (elementRect.top - containerRect.top);

          messagesContainer.scrollTo({
            top: scrollTop,
            behavior: 'auto' // Safari mobile doesn't handle smooth well
          });
        } else {
          // Standard scrollIntoView for other browsers - scroll to top of message
          lastMessageElement.scrollIntoView({
            behavior: isMobile ? 'auto' : 'smooth',
            block: 'start'
          });
        }
      }
    }, 200); // Longer delay for Safari mobile rendering
  };

  useEffect(() => {
    // Scroll to top of latest message (user or AI response)
    if (messages.length > 0) {
      scrollToLatestMessage();
    }
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (fileProcessing) return; // Don't submit while processing file
    
    let messageContent = inputValue.trim();
    let documentContent = null;
    
    // Process file if selected
    if (selectedFile) {
      try {
        setFileProcessing(true);
        setFileProcessingProgress(0);
        
        const extractedText = await extractTextFromFile(selectedFile, setFileProcessingProgress);
        
        // Process text with intelligent chunking for large documents
        const { processedText, isChunked, totalChunks } = processExtractedText(extractedText, messageContent);
        
        // Store processed text separately for API call
        documentContent = processedText;
        
        // Clear file after processing
        setSelectedFile(null);
        setFileProcessing(false);
        setFileProcessingProgress(0);
        
      } catch (error) {
        setFileProcessing(false);
        setFileProcessingProgress(0);
        alert(`Greška prilikom procesiranja fajla: ${error.message}`);
        return;
      }
    }
    
    if (messageContent && !isLoading) {
      // Create message request object with separate user message and document content
      const messageRequest = {
        question: messageContent,
        documentContent: documentContent,
        documentFilename: selectedFile ? selectedFile.name : null
      };
      console.log('🔍 ChatArea: Sending message request:', {
        question: messageContent,
        hasDocumentContent: !!documentContent,
        documentContentLength: documentContent ? documentContent.length : 0
      });
      onSendMessage(messageRequest);
      setInputValue('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleExampleQuestionClick = (questionText) => {
    if (isLoading) return; // Don't allow if already loading
    
    // Submit directly with the question
    if (questionText) {
      const messageRequest = {
        question: questionText,
        documentContent: null,
        documentFilename: null
      };
      onSendMessage(messageRequest);
      setInputValue(''); // Clear input after sending
    }
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      
      const newHeight = Math.min(textarea.scrollHeight, 120);
      textarea.style.height = newHeight + 'px';
      
      // Only show scrollbar when content actually exceeds max height
      if (textarea.scrollHeight > 120) {
        textarea.style.overflowY = 'scroll';
      } else {
        textarea.style.overflowY = 'hidden';
      }
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue]);

  // File upload and voice input handlers
  const isPremiumUser = () => {
    return userStatus && ['professional', 'team', 'premium'].includes(userStatus.access_type);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check if user is premium
    if (!isPremiumUser()) {
      // Clear file input first
      e.target.value = '';
      
      // If not authenticated (not logged in), show register/login modal first
      if (!isAuthenticated && onOpenAuthModal) {
        onOpenAuthModal();
        return;
      }
      
      // If authenticated but not premium, show plan selection
      if (isAuthenticated && onOpenPlanSelection) {
        onOpenPlanSelection();
        return;
      }
      
      // Fallback alert
      alert('Upload fajlova je dostupan za Professional i Team planove.');
      return;
    }

    // Validate file
    if (!isFileTypeSupported(file)) {
      alert('Nepodržan tip fajla. Podržani tipovi: PDF, DOCX, TXT, RTF');
      e.target.value = '';
      return;
    }

    if (!isFileSizeValid(file)) {
      alert('Fajl je prevelik. Maksimalna veličina je 10MB.');
      e.target.value = '';
      return;
    }

    setSelectedFile(file);
    e.target.value = ''; // Clear input for next selection
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
    setFileProcessing(false);
    setFileProcessingProgress(0);
  };

  const handleFileUploadClick = () => {
    // Check if user is premium
    if (!isPremiumUser()) {
      // If not authenticated (not logged in), show register/login modal first
      if (!isAuthenticated && onOpenAuthModal) {
        onOpenAuthModal();
        return;
      }
      
      // If authenticated but not premium, show plan selection
      if (isAuthenticated && onOpenPlanSelection) {
        onOpenPlanSelection();
        return;
      }
      
      // Fallback alert
      alert('Upload fajlova je dostupan za Professional i Team planove.');
      return;
    }

    fileInputRef.current?.click();
  };

  // Speech-to-text functionality
  const startRecording = async () => {
    console.log('🎙️ Starting recording...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('🎙️ Microphone access granted');
      
      const mediaRecorder = new MediaRecorder(stream);
      console.log('🎙️ MediaRecorder created, supported type:', MediaRecorder.isTypeSupported('audio/webm'));
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        console.log('🎙️ Data available, size:', event.data.size);
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log('🎙️ Recording stopped, chunks:', audioChunksRef.current.length);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        console.log('🎙️ Audio blob created:', { size: audioBlob.size, type: audioBlob.type });
        transcribeAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      console.log('🎙️ Recording started');
      setIsRecording(true);
    } catch (error) {
      console.error('🎙️ Error accessing microphone:', error);
      alert('Greška pri pristupu mikrofonu. Molimo proverite dozvole.');
    }
  };

  const stopRecording = () => {
    console.log('🎙️ Stop recording called');
    if (mediaRecorderRef.current && isRecording) {
      console.log('🎙️ Stopping MediaRecorder...');
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessingAudio(true);
      console.log('🎙️ Recording stopped, processing will start...');
    } else {
      console.warn('🎙️ Stop recording called but no active recording found');
    }
  };

  const transcribeAudio = async (audioBlob) => {
    console.log('🎙️ Starting transcription process...');
    console.log('🎙️ Audio blob size:', audioBlob.size, 'bytes');
    console.log('🎙️ Audio blob type:', audioBlob.type);
    
    try {
      // Import device fingerprinting (same as other API calls)
      const { getDeviceFingerprint } = await import('../utils/deviceFingerprint.js');
      
      // Get auth token if user is authenticated
      const token = localStorage.getItem('norma_ai_access_token');
      const deviceFingerprint = await getDeviceFingerprint();
      const headers = {
        'X-Device-Fingerprint': deviceFingerprint
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      console.log('🎙️ Request headers:', headers);
      console.log('🎙️ Auth token present:', !!token);
      console.log('🎙️ Device fingerprint:', deviceFingerprint);

      // Call secure backend endpoint instead of OpenAI directly
      console.log('🎙️ Sending request to backend...');
      const response = await fetch('https://norma-ai.fly.dev/api/transcribe', {
        method: 'POST',
        headers: headers,
        body: audioBlob  // Send raw audio blob directly
      });

      console.log('🎙️ Response status:', response.status);
      console.log('🎙️ Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const data = await response.json();
        console.log('🎙️ Transcription response:', data);
        let transcribedText = data.text;
        
        if (!transcribedText || transcribedText.trim() === '') {
          console.warn('🎙️ Empty transcription received');
          alert('Nisu detektovane reči u audio snimku. Pokušajte ponovo.');
          return;
        }
        
        // Convert Cyrillic to Latin if needed
        try {
          const { convertIfCyrillic } = await import('../utils/cyrillicToLatin.js');
          const conversion = convertIfCyrillic(transcribedText);
          
          if (conversion.wasCyrillic) {
            console.log('🎙️ Cyrillic detected, converting to Latin:');
            console.log('🎙️ Original (Cyrillic):', conversion.originalText);
            console.log('🎙️ Converted (Latin):', conversion.text);
            transcribedText = conversion.text;
          } else {
            console.log('🎙️ No Cyrillic detected, using original text');
          }
        } catch (error) {
          console.warn('🎙️ Cyrillic conversion failed, using original text:', error);
          // Continue with original text if conversion fails
        }
        
        // Append to existing input or replace if empty
        const currentText = inputValue.trim();
        const newText = currentText 
          ? `${currentText} ${transcribedText}` 
          : transcribedText;
        
        console.log('🎙️ Setting input text:', newText);
        setInputValue(newText);
        
        // Adjust textarea height after setting new content
        setTimeout(() => {
          adjustTextareaHeight();
        }, 0);
      } else {
        // Get error details from response (clone to avoid body stream issues)
        const responseClone = response.clone();
        let errorText = '';
        try {
          const errorData = await response.json();
          errorText = errorData.message || errorData.error || 'Unknown error';
          console.error('🎙️ Backend error response:', errorData);
        } catch (e) {
          try {
            errorText = await responseClone.text();
            console.error('🎙️ Backend error text:', errorText);
          } catch (e2) {
            errorText = 'Unknown error';
            console.error('🎙️ Could not read response body:', e2);
          }
        }
        
        if (response.status === 429) {
          console.error('🎙️ Rate limit exceeded');
          alert('Dostigli ste limit pokušaja. Molimo registrujte se za premium pristup.');
        } else if (response.status === 401) {
          console.error('🎙️ Authentication error');
          alert('Greška autorizacije. Molimo prijavite se ponovo.');
        } else {
          console.error('🎙️ HTTP error:', response.status, errorText);
          alert(`Greška pri transkribovanju (${response.status}): ${errorText}`);
        }
      }
    } catch (error) {
      console.error('🎙️ Transcription error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        alert('Greška konekcije sa serverom. Proverite internetsku vezu.');
      } else {
        alert(`Greška pri pretvaranju govora u tekst: ${error.message}`);
      }
    } finally {
      setIsProcessingAudio(false);
    }
  };

  const handleMicrophoneClick = () => {
    // Check if user is premium (same logic as file upload)
    if (!isPremiumUser()) {
      // If not authenticated (not logged in), show register/login modal first
      if (!isAuthenticated && onOpenAuthModal) {
        onOpenAuthModal();
        return;
      }
      
      // If authenticated but not premium, show plan selection
      if (isAuthenticated && onOpenPlanSelection) {
        onOpenPlanSelection();
        return;
      }
      
      // Fallback alert
      alert('Snimanje glasa je dostupno samo premium korisnicima.');
      return;
    }

    if (isRecording) {
      stopRecording();
    } else if (!isProcessingAudio) {
      startRecording();
    }
  };

  return (
    <div className="chat-area">
      <div className="chat-content-wrapper">
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-content">
              <h1>Imate pravno pitanje?</h1>
              <p>Vaš pravni asistent za srpsko zakonodavstvo</p>
              <div className="example-questions">
                <div className="question-examples">
                  <div
                    className="example-question clickable"
                    onClick={() => handleExampleQuestionClick("Koja je kazna za prelazak na crveno svetlo?")}
                  >
                    Koja je kazna za prelazak na crveno svetlo?
                  </div>
                  <div
                    className="example-question clickable"
                    onClick={() => handleExampleQuestionClick("Koji su uslovi za zaključivanje braka u Srbiji?")}
                  >
                    Koji su uslovi za zaključivanje braka u Srbiji?
                  </div>
                  <div
                    className="example-question clickable"
                    onClick={() => handleExampleQuestionClick("Kakva je procedura za osnivanje društva sa ograničenom odgovornošću?")}
                  >
                    Kakva je procedura za osnivanje društva sa ograničenom odgovornošću?
                  </div>
                </div>
              </div>
              <p className="start-hint">
                Postavite pitanje u polje ispod za početak
              </p>
            </div>
          </div>
        ) : (
          <div className="messages-wrapper">
            <div className="messages-container">
              {(
                  messages.map((message, index) => (
                    <MessageBubble
                      key={index}
                      message={message}
                      isUser={message.role === 'user'}
                    />
                  ))
                )}

                {isLoading && (
                  <div className="loading-indicator">
                    <div className="typing-animation">
                      <div className="dot"></div>
                      <div className="dot"></div>
                      <div className="dot"></div>
                    </div>
                  </div>
                )}

              </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        {/* File preview section */}
        {selectedFile && (
          <div className="file-preview">
            <div className="file-preview-content">
              <div className="file-info">
                <span className="file-icon">📄</span>
                <div className="file-details">
                  <span className="file-name">{selectedFile.name}</span>
                  <span className="file-meta">
                    {getFileTypeDisplayName(selectedFile)} • {formatFileSize(selectedFile.size)}
                  </span>
                </div>
              </div>
              {fileProcessing && (
                <div className="file-processing">
                  <div className="processing-bar">
                    <div 
                      className="processing-progress" 
                      style={{ width: `${fileProcessingProgress}%` }}
                    />
                  </div>
                  <span className="processing-text">Procesiranje...</span>
                </div>
              )}
              {!fileProcessing && (
                <button 
                  type="button" 
                  className="file-remove-btn"
                  onClick={handleFileRemove}
                  title="Ukloni fajl"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Feature action buttons */}
        <div className="feature-actions">
          <button
            type="button"
            onClick={handleFileUploadClick}
            className="feature-action-btn"
            title={isPremiumUser() ? "Upload dokument" : "Upload fajlova - dostupno za Professional i Team planove"}
            disabled={isLoading || fileProcessing || isRecording || isProcessingAudio}
          >
            <div className="chat-feature-icon">
              <Icon name="paperclip" size={16} />
            </div>
            <span className="feature-label">Upload</span>
          </button>

          <button
            type="button"
            onClick={() => setTemplateLibraryOpen(true)}
            className="feature-action-btn"
            title="Ugovori i Obrasci"
            disabled={isLoading || fileProcessing}
          >
            <div className="chat-feature-icon">
              <Icon name="folder" size={16} />
            </div>
            <span className="feature-label">Ugovori i Obrasci</span>
          </button>
        </div>

        <div className="input-container">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.rtf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          <div className="message-input-wrapper">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={(e) => {
                // On iOS, scroll input into view when focused to ensure it's visible above keyboard
                setTimeout(() => {
                  e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 300);
              }}
              placeholder={selectedFile ? "Dodajte komentar (opciono)..." : "Postavite pitanje o zakonu..."}
              disabled={isLoading || fileProcessing || isRecording}
              rows={1}
              className="message-input"
            />

            {/* Microphone button inside input */}
            <button
              type="button"
              onClick={handleMicrophoneClick}
              className={`mic-btn-inline ${isRecording ? 'recording' : ''} ${isProcessingAudio ? 'processing' : ''}`}
              title={
                isRecording 
                  ? "Zaustavite snimanje" 
                  : isProcessingAudio 
                    ? "Procesiranje..." 
                    : isPremiumUser()
                      ? "Snimite pitanje"
                      : "Snimanje glasa - dostupno za Professional i Team planove"
              }
              disabled={isLoading || fileProcessing}
            >
              {isProcessingAudio ? (
                <div className="processing-spinner">⏳</div>
              ) : (
                <Icon name={isRecording ? "micOff" : "mic"} size={18} />
              )}
            </button>

            <button
              type="submit"
              disabled={(!inputValue.trim() && !selectedFile) || isLoading || fileProcessing || isRecording || isProcessingAudio}
              className="send-button-inline"
              title="Pošalji poruku"
            >
              <span className="send-icon">
                {fileProcessing ? (
                  <div className="processing-spinner">⏳</div>
                ) : (
                  <Icon name="send" size={18} />
                )}
              </span>
            </button>
          </div>
        </div>

        <div className="input-hint">
          {(userStatus && userStatus.total_messages_sent === 0) ? (
            <>
              Korišćenjem Norma AI slažete se sa našim{' '}
              <a href="https://normaai.rs/uslovi.html" target="_blank" rel="noopener noreferrer">
                Uslovima korišćenja
              </a>
              {' '}i{' '}
              <a href="https://normaai.rs/privatnost.html" target="_blank" rel="noopener noreferrer">
                Politikom privatnosti
              </a>
              .
            </>
          ) : (
            'AI može praviti greške. Proveriti bitne informacije.'
          )}
        </div>
      </form>

      {/* Template Library Modal */}
      <TemplateLibraryModal
        isOpen={templateLibraryOpen}
        onClose={() => setTemplateLibraryOpen(false)}
        userStatus={userStatus}
        onOpenAuthModal={onOpenAuthModal}
        onOpenPlanSelection={onOpenPlanSelection}
        isAuthenticated={isAuthenticated}
      />
    </div>
  );
};

export default ChatArea;