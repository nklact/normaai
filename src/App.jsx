import { useState, useEffect, useRef } from "react";
import "./App.css";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import LawSelector from "./components/LawSelector";
import AnnouncementBar from "./components/AnnouncementBar";
import ConfirmDialog from "./components/ConfirmDialog";
import ErrorDialog from "./components/ErrorDialog";
import AuthModal from "./components/AuthModal";
import PlanSelectionModal from "./components/PlanSelectionModal";
import SubscriptionManagementModal from "./components/SubscriptionManagementModal";
import UpdateChecker from "./components/UpdateChecker";
import { ThemeProvider } from "./contexts/ThemeContext";
import apiService from "./services/api";

function App() {
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true); // Start as true to show skeleton on mount

  // Track pending chat creation to prevent race conditions
  const pendingChatCreation = useRef(null);

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userStatus, setUserStatus] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState('login');
  const [authModalReason, setAuthModalReason] = useState(null); // Why the auth modal was opened

  // Plan selection state
  const [planSelectionModalOpen, setPlanSelectionModalOpen] = useState(false);

  // Subscription management state
  const [subscriptionModalOpen, setSubscriptionModalOpen] = useState(false);
  
  // Modal states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState(null);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Mobile menu state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Prevent duplicate initial chat creation from React StrictMode
  const hasAttemptedInitialChatCreation = useRef(false);

  useEffect(() => {
    console.log('🔍 DEBUG: App useEffect starting - parallel initializeAuth and loadChats');
    // Run in parallel for faster loading
    Promise.all([
      initializeAuth(),
      loadChats()
    ]);
  }, []);

  // Detect Tauri iOS app for platform-specific styling
  useEffect(() => {
    if (window.__TAURI__) {
      // We're in Tauri - check if it's iOS
      const platform = navigator.platform || navigator.userAgentData?.platform || '';
      const isIOS = /iPhone|iPad|iPod/.test(platform) || /iPhone|iPad|iPod/.test(navigator.userAgent);

      if (isIOS) {
        document.documentElement.classList.add('tauri-ios');
        console.log('🔍 Detected Tauri iOS app - added tauri-ios class');
      }
    }
  }, []);

  // Detect keyboard open/close to adjust bottom padding
  useEffect(() => {
    // Only on mobile devices
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || !window.visualViewport) return;

    const handleViewportResize = () => {
      // When keyboard opens, visualViewport height decreases
      // When keyboard closes, visualViewport height increases back to window height
      const viewportHeight = window.visualViewport.height;
      const windowHeight = window.innerHeight;

      // Keyboard is considered "open" if viewport is significantly smaller than window
      const keyboardOpen = viewportHeight < windowHeight - 100; // 100px threshold

      if (keyboardOpen) {
        document.documentElement.classList.add('keyboard-open');
      } else {
        document.documentElement.classList.remove('keyboard-open');
      }
    };

    // Listen to viewport resize events
    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', handleViewportResize);

    // Initial check
    handleViewportResize();

    // Cleanup
    return () => {
      window.visualViewport.removeEventListener('resize', handleViewportResize);
      window.visualViewport.removeEventListener('scroll', handleViewportResize);
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);

  // Initialize authentication state
  const initializeAuth = async () => {
    try {
      // Wait for auth manager to load tokens from storage
      await apiService.ensureInitialized();

      // Check if user has stored token
      const hasToken = apiService.isAuthenticated();

      // Load user status
      const status = await apiService.getUserStatus();
      console.log('🔍 DEBUG: getUserStatus() returned:', JSON.stringify(status, null, 2));
      setUserStatus(status);

      // Only set authenticated to true if we have both token AND user data with email
      const authenticated = hasToken && status && status.email;
      setIsAuthenticated(authenticated);

      // If no user status found, initialize trial
      console.log('🔍 DEBUG: Checking if trial creation needed');
      console.log('🔍 DEBUG: - status exists:', !!status);
      console.log('🔍 DEBUG: - status.email:', status?.email);
      console.log('🔍 DEBUG: - status.access_type:', status?.access_type);
      console.log('🔍 DEBUG: - status.messages_remaining:', status?.messages_remaining);
      console.log('🔍 DEBUG: - status.user_id:', status?.user_id);
      console.log('🔍 DEBUG: - status.account_type:', status?.account_type);
      
      if (!status || (!status.email && status.user_id === null)) {
        console.log('🔍 DEBUG: No user status found, starting trial');
        try {
          const trialResult = await apiService.startTrial();
          console.log('🔍 DEBUG: Trial started:', trialResult);
          const newStatus = await apiService.getUserStatus();
          setUserStatus(newStatus);
        } catch (trialError) {
          console.error('Error starting trial:', trialError);
          console.error('Error details:', {
            message: trialError.message,
            stack: trialError.stack
          });

          // Check if error is IP limit exceeded
          const errorMsg = trialError.message || '';
          if (errorMsg.includes('429') || errorMsg.includes('IP_LIMIT_EXCEEDED')) {
            console.log('🔍 DEBUG: IP limit exceeded, showing auth modal');
            setAuthModalReason('ip_limit_exceeded');
            setAuthModalOpen(true);
          }
        }
      } else {
        console.log('🔍 DEBUG: User status exists, skipping trial creation');
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
      
      // Check if it's a session expiration error
      if (error.message === 'Session expired. Please log in again.') {
        console.log('Session expired during initialization, clearing auth state');
        setIsAuthenticated(false);
        setUserStatus(null);
        setAuthModalOpen(true);
        return;
      }
      
      // If getUserStatus fails, try to start trial as fallback
      try {
        console.log('🔍 DEBUG: getUserStatus failed, trying to start trial as fallback');
        const trialResult = await apiService.startTrial();
        const newStatus = await apiService.getUserStatus();
        setUserStatus(newStatus);
      } catch (trialError) {
        console.error('Error starting fallback trial:', trialError);

        // Check if error is IP limit exceeded
        const errorMsg = trialError.message || '';
        if (errorMsg.includes('429') || errorMsg.includes('IP_LIMIT_EXCEEDED')) {
          console.log('🔍 DEBUG: IP limit exceeded, showing auth modal');
          setAuthModalReason('ip_limit_exceeded');
          setAuthModalOpen(true);
        }
      }
    }
  };

  useEffect(() => {
    if (currentChatId) {
      // Skip loading messages if we're currently creating a new chat
      // (messages are already set to empty by createNewChat)
      if (pendingChatCreation.current) {
        return;
      }
      loadMessages(currentChatId);
    }
  }, [currentChatId]);

  const loadChats = async () => {
    try {
      console.log('🔍 DEBUG: loadChats() starting');
      setIsLoadingChats(true);
      const chatList = await apiService.getChats();
      console.log('🔍 DEBUG: loadChats() got chatList:', chatList.length, 'chats');
      setChats(chatList);

      // Auto-create first chat if none exist (like ChatGPT) - but only once during init
      if (chatList.length === 0 && !hasAttemptedInitialChatCreation.current) {
        console.log('🔍 DEBUG: loadChats() - no chats found, calling createNewChat()');
        hasAttemptedInitialChatCreation.current = true;
        await createNewChat();
      } else if (!currentChatId && chatList.length > 0) {
        // If chats exist but none selected, select the most recent
        console.log('🔍 DEBUG: loadChats() - chats exist, selecting most recent');
        setCurrentChatId(chatList[0].id);
      }
    } catch (error) {
      console.error("Error loading chats:", error);
    } finally {
      setIsLoadingChats(false);
    }
  };

  const loadMessages = async (chatId) => {
    try {
      // Skip loading if chat ID is invalid or temporary - no messages exist yet
      if (!chatId || (typeof chatId === 'string' && chatId.startsWith('temp_'))) {
        setMessages([]);
        setIsLoadingMessages(false);
        return;
      }
      setIsLoadingMessages(true);
      const messageList = await apiService.getMessages(chatId);
      setMessages(messageList);
    } catch (error) {
      console.error("Error loading messages:", error);
      // Don't show error to user for message loading failures
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const createNewChat = async (force = false) => {
    console.log('🔍 DEBUG: createNewChat() called, force:', force, 'currentChatId:', currentChatId, 'messages.length:', messages.length, 'pendingChatCreation:', !!pendingChatCreation.current);

    // If there's already a pending chat creation, return that promise
    if (pendingChatCreation.current) {
      console.log('🔍 DEBUG: createNewChat() - returning existing pending promise');
      return pendingChatCreation.current;
    }

    // Prevent spam: If current chat is empty, focus it instead of creating new one
    if (!force && currentChatId && messages.length === 0 && !(typeof currentChatId === 'string' && currentChatId.startsWith('temp_'))) {
      console.log('🔍 DEBUG: createNewChat() - current chat is empty, returning current chat ID');
      return currentChatId;
    }

    // Create the promise
    const promise = (async () => {
      try {
        const title = "Nova konverzacija";
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Optimistic UI: Create chat immediately in UI
        setChats(prevChats => [{ id: tempId, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), isOptimistic: true }, ...prevChats]);
        setCurrentChatId(tempId);
        setMessages([]);

        // Create chat on server and get real ID
        const actualChatId = await apiService.createChat(title);
        console.log('🔍 DEBUG: createNewChat() - got actualChatId:', actualChatId);

        // Replace optimistic chat with real one
        setChats(prevChats => prevChats.map(chat => chat.id === tempId ? { ...chat, id: actualChatId, isOptimistic: false } : chat));
        setCurrentChatId(actualChatId);

        return actualChatId;
      } catch (error) {
        console.error("🔍 DEBUG: Error creating chat:", error);

        // Rollback optimistic UI
        setChats(prevChats => prevChats.filter(chat => !chat.isOptimistic));
        setCurrentChatId(null);
        setMessages([]);

        setErrorMessage(`Greška prilikom kreiranja konverzacije: ${error.message || error}`);
        setErrorDialogOpen(true);

        throw error; // Re-throw so the caller knows it failed
      }
    })();

    // Store and track the promise
    pendingChatCreation.current = promise;

    // Clear the reference when done (success or failure)
    promise.finally(() => {
      console.log('🔍 DEBUG: createNewChat() - clearing pendingChatCreation');
      pendingChatCreation.current = null;
    });

    return promise;
  };

  const handleDeleteChat = (chatId) => {
    setChatToDelete(chatId);
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteChat = async () => {
    const chatToDeleteObj = chats.find(chat => chat.id === chatToDelete);
    
    try {
      // If it's an optimistic chat, no need to call server
      if (!chatToDeleteObj?.isOptimistic) {
        await apiService.deleteChat(chatToDelete);
      }
    } catch (error) {
      // If chat doesn't exist on server (404), that's fine - we wanted it deleted anyway
      if (error.message !== 'HTTP 404') {
        console.error("Error deleting chat:", error);
        setErrorMessage(`Greška prilikom brisanja konverzacije: ${error.message}`);
        setErrorDialogOpen(true);
        return; // Don't proceed with local deletion if there was a real error
      }
    }
    
    // Check if this is the last conversation before removing it
    const remainingChats = chats.filter(chat => chat.id !== chatToDelete);
    const isLastConversation = remainingChats.length === 0;
    
    if (isLastConversation) {
      // If deleting the last conversation, create a new one first, then remove the old one
      setCurrentChatId(null);
      setMessages([]);
      await createNewChat(true);
      // Now remove the old chat from the list
      setChats(prevChats => prevChats.filter(chat => chat.id !== chatToDelete));
    } else {
      // Remove from local state and switch to another chat if needed
      setChats(remainingChats);
      if (currentChatId === chatToDelete) {
        // Switch to the most recent remaining conversation
        setCurrentChatId(remainingChats[0].id);
      }
    }
  };

  // Authentication handlers
  const handleAuthSuccess = async (result) => {
    // Reload user status and chats
    try {
      const status = await apiService.getUserStatus();
      setUserStatus(status);
      
      // Only set authenticated if we have complete user data
      if (status && status.email) {
        setIsAuthenticated(true);
        
        // If user has 0 messages left after login, show plan selection modal
        if (status.messages_remaining !== null && status.messages_remaining <= 0) {
          setTimeout(() => {
            setPlanSelectionModalOpen(true);
          }, 1000); // Small delay to let auth modal close first
        }
      }
      
      await loadChats(); // Reload chats to get any migrated trial chats
    } catch (error) {
      console.error('Error loading user data after auth:', error);
    }
  };

  const handleLogin = () => {
    setAuthInitialTab('login');
    setAuthModalOpen(true);
  };

  const handleRegister = () => {
    setAuthInitialTab('register');
    setAuthModalOpen(true);
  };

  const handleLogout = async () => {
    try {
      await apiService.logout();
      setIsAuthenticated(false);
      setUserStatus(null);
      setChats([]);
      setCurrentChatId(null);
      setMessages([]);
      
      // Restart trial for the device
      await initializeAuth();
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  // Plan management handlers
  const handleOpenPlanSelection = () => {
    if (['individual', 'professional', 'team', 'premium'].includes(userStatus?.access_type)) {
      setSubscriptionModalOpen(true);
    } else {
      setPlanSelectionModalOpen(true);
    }
  };

  const handleClosePlanSelection = () => {
    setPlanSelectionModalOpen(false);
  };

  const handleCloseSubscriptionModal = () => {
    setSubscriptionModalOpen(false);
  };

  const handleSubscriptionChange = async (action, data) => {
    try {
      if (action === 'cancelled') {
        // Refresh user status to reflect cancellation
        const status = await apiService.getUserStatus();
        setUserStatus(status);
        setIsAuthenticated(apiService.isAuthenticated());
      } else if (action === 'billing_period_changed') {
        // Handle billing period change
        console.log('Billing period changed to:', data.newPeriod);
      }
    } catch (error) {
      console.error('Subscription change error:', error);
    }
  };

  const handlePlanChange = async (planId, planData) => {
    try {
      // Process payment first (placeholder)
      const paymentResult = await apiService.processPayment(planId, planData);
      
      if (paymentResult.success) {
        // Update plan in database
        const upgradeResult = await apiService.upgradePlan(planId, planData);
        
        if (upgradeResult.success) {
          // Update user status locally (placeholder behavior)
          const updatedStatus = {
            ...userStatus,
            access_type: planId,
            messages_remaining: ['professional', 'team', 'premium'].includes(planId) ? null : (planId === 'individual' ? 20 : userStatus.messages_remaining)
          };
          setUserStatus(updatedStatus);
          
          // Show success message
          setErrorMessage(`Plan je uspešno nadograđen na ${planData.name}! Dobrodošli u novu eru pravnog saveta.`);
          setErrorDialogOpen(true);
          
          return true;
        } else {
          throw new Error(upgradeResult.message || 'Plan upgrade failed');
        }
      } else {
        throw new Error(paymentResult.message || 'Payment processing failed');
      }
    } catch (error) {
      console.error('Plan change error:', error);
      setErrorMessage(`Greška prilikom nadogradnje plana: ${error.message}`);
      setErrorDialogOpen(true);
      throw error;
    }
  };

  // Generate friendly chat title from user's first message
  const generateChatTitle = (message) => {
    // Remove extra whitespace and limit length
    const cleaned = message.trim().substring(0, 50);
    
    // If message is too short or generic, create a descriptive title
    if (cleaned.length < 10) {
      return "Pravni razgovor";
    }
    
    // Add ellipsis if truncated
    return cleaned.length === 50 ? `${cleaned}...` : cleaned;
  };

  const sendMessage = async (messageRequest) => {
    // Handle backwards compatibility - if string is passed, convert to object
    const request = typeof messageRequest === 'string' 
      ? { question: messageRequest, documentContent: null }
      : messageRequest;
    
    const { question, documentContent, documentFilename } = request;
    // Check message limits before sending message
    if (userStatus && userStatus.messages_remaining !== null && userStatus.messages_remaining <= 0) {
      // If user is authenticated, show plan selection modal
      if (isAuthenticated) {
        setPlanSelectionModalOpen(true);
        return;
      }
      // If user is not authenticated, show auth modal
      else {
        setAuthModalReason('trial_exhausted');
        setAuthModalOpen(true);
        return;
      }
    }

    // Ensure we have a valid (non-temp) chat ID before sending
    let activeChatId = currentChatId;

    if (!activeChatId || (typeof activeChatId === 'string' && activeChatId.startsWith('temp_'))) {
      console.log('🔍 No valid chat ID, creating/waiting for chat...');
      activeChatId = await createNewChat();

      if (!activeChatId) {
        setErrorMessage('Greška prilikom kreiranja konverzacije. Molimo pokušajte ponovo.');
        setErrorDialogOpen(true);
        return;
      }
    }

    setIsLoading(true);

    // Add user message immediately for instant feedback
    const userMessage = {
      role: "user",
      content: question,
      law_name: null, // Will be auto-detected by backend
      created_at: new Date().toISOString(),
      isOptimistic: true, // Flag for error handling
      has_document: !!documentContent, // Indicate if document was uploaded (will be replaced by DB value)
      document_filename: documentFilename // Store filename for display
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const requestData = {
        question,
        document_content: documentContent,
        document_filename: documentFilename,
        chat_id: activeChatId
        // law_name and law_url removed - will be auto-detected by backend
      };

      console.log('🔍 App: Sending API request:', {
        question,
        hasDocumentContent: !!documentContent,
        documentContentLength: documentContent ? documentContent.length : 0,
        chat_id: activeChatId
      });

      console.log("🔍 Sending message to chat:", activeChatId);

      const response = await apiService.askQuestion(requestData);

      // Format AI message content to match MessageBubble expectations
      // Backend stores it with "Reference:" separator, so we recreate that format
      let aiMessageContent = response.answer;

      if (response.law_quotes && response.law_quotes.length > 0) {
        const referenceHeader = response.law_name
          ? `Reference: ${response.law_name}`
          : 'Reference:';

        aiMessageContent = `${response.answer}\n\n${referenceHeader}\n${response.law_quotes.join('\n\n')}`;
      }

      // Create AI message object matching database schema
      const aiMessage = {
        role: "assistant",
        content: aiMessageContent,
        law_name: response.law_name || null,
        created_at: new Date().toISOString(),
        has_document: false,
        document_filename: null,
        // Add contract generation metadata if present
        generated_contract: response.generated_contract || null,
      };

      // Update messages: remove optimistic flag from user message and add AI response
      setMessages(prev => [
        ...prev.map(msg =>
          msg.isOptimistic && msg.content === question
            ? { ...msg, isOptimistic: false }
            : msg
        ),
        aiMessage
      ]);

      // Refresh chat list in background (non-blocking)
      loadChats().catch(err => console.warn('Could not refresh chat list:', err));

      // Update chat title with first user message if it's still default
      const currentChat = chats.find(chat => chat.id === activeChatId);
      if (currentChat && currentChat.title === 'Nova konverzacija') {
        try {
          const newTitle = generateChatTitle(question);
          await apiService.updateChatTitle(activeChatId, newTitle);

          // Update local state
          setChats(prevChats =>
            prevChats.map(chat =>
              chat.id === activeChatId
                ? { ...chat, title: newTitle }
                : chat
            )
          );
        } catch (titleError) {
          console.warn('Could not update chat title:', titleError);
        }
      }

      // Refresh user status to update message count
      try {
        const status = await apiService.getUserStatus();
        setUserStatus(status);
      } catch (statusError) {
        console.warn('Could not refresh user status:', statusError);
      }

    } catch (error) {
      console.error("❌ DEBUG: Error in sendMessage:", error);
      console.error("❌ DEBUG: Error details:", {
        message: error.message || error,
        stack: error.stack,
        cause: error.cause
      });
      
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => !(msg.isOptimistic && msg.content === question)));
      
      const errorMsg = error.message || error.toString();
      
      // Handle different error types
      if (errorMsg === 'Session expired. Please log in again.') {
        console.log('Session expired during message send, clearing auth state');
        setIsAuthenticated(false);
        setUserStatus(null);
        setErrorMessage('Vaša sesija je istekla. Molimo prijavite se ponovo.');
        setErrorDialogOpen(true);
        setTimeout(() => setAuthModalOpen(true), 2000);
      } else if (errorMsg.includes('HTTP 429') || errorMsg.includes('429')) {
        // Trial limit exceeded - show registration modal
        setErrorMessage('Dostigli ste limit pokušaja. Molimo registrujte se za nastavak.');
        setErrorDialogOpen(true);
        setTimeout(() => {
          setAuthModalReason('trial_exhausted');
          setAuthModalOpen(true);
        }, 1500);
      } else if (errorMsg.includes('trial') || errorMsg.includes('limit') || errorMsg.includes('expired')) {
        setErrorMessage(`${errorMsg} Molimo registrujte se za nastavak.`);
        setErrorDialogOpen(true);
        setTimeout(() => setAuthModalOpen(true), 2000);
      } else {
        setErrorMessage(`Greška prilikom slanja poruke: ${errorMsg}`);
        setErrorDialogOpen(true);
      }
    } finally {
      setIsLoading(false);
    }
  };


  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <ThemeProvider>
      <UpdateChecker />
      <div className="app">
        {/* Mobile Overlay */}
        <div
          className={`mobile-overlay ${isMobileMenuOpen ? 'open' : ''}`}
          onClick={closeMobileMenu}
        />
        
        <Sidebar
          chats={chats}
          currentChatId={currentChatId}
          onChatSelect={setCurrentChatId}
          onNewChat={createNewChat}
          onDeleteChat={handleDeleteChat}
          isMobileMenuOpen={isMobileMenuOpen}
          onCloseMobileMenu={closeMobileMenu}
          isLoadingChats={isLoadingChats}
          // Authentication props
          isAuthenticated={isAuthenticated}
          userStatus={userStatus}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onLogout={handleLogout}
          // Plan management props
          onOpenPlanSelection={handleOpenPlanSelection}
        />
        <div className="main-content">
          <LawSelector
            onToggleMobileMenu={toggleMobileMenu}
            isAuthenticated={isAuthenticated}
            onLogin={handleLogin}
            onRegister={handleRegister}
          />
          <AnnouncementBar />
          <ChatArea
            messages={messages}
            onSendMessage={sendMessage}
            isLoading={isLoading}
            isLoadingMessages={isLoadingMessages}
            currentChatId={currentChatId}
            userStatus={userStatus}
            onOpenPlanSelection={handleOpenPlanSelection}
            onOpenAuthModal={() => setAuthModalOpen(true)}
            isAuthenticated={isAuthenticated}
          />
        </div>
        
        {/* Modals */}
        <ConfirmDialog
          isOpen={deleteConfirmOpen}
          onClose={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDeleteChat}
          title="Obriši konverzaciju"
          message="Da li ste sigurni da želite da obrišete ovu konverzaciju? Ova radnja se ne može poništiti."
          confirmText="Obriši"
          cancelText="Otkaži"
          type="delete"
        />
        
        <ErrorDialog
          isOpen={errorDialogOpen}
          onClose={() => setErrorDialogOpen(false)}
          title="Greška"
          message={errorMessage}
          buttonText="U redu"
        />

        <AuthModal
          isOpen={authModalOpen}
          onClose={() => {
            setAuthModalOpen(false);
            setAuthModalReason(null); // Clear reason when closing
          }}
          onSuccess={handleAuthSuccess}
          initialTab={authInitialTab}
          reason={authModalReason}
        />

        <PlanSelectionModal
          isOpen={planSelectionModalOpen}
          onClose={handleClosePlanSelection}
          currentPlan={userStatus?.access_type || 'trial'}
          userStatus={userStatus}
          onPlanChange={handlePlanChange}
        />

        <SubscriptionManagementModal
          isOpen={subscriptionModalOpen}
          onClose={handleCloseSubscriptionModal}
          userStatus={userStatus}
          onSubscriptionChange={handleSubscriptionChange}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;