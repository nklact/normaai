import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Icon from './Icons';
import { ConversationsSkeleton } from './Skeleton';
import './Sidebar.css';

const Sidebar = ({
  chats,
  currentChatId,
  onChatSelect,
  onNewChat,
  onDeleteChat,
  isMobileMenuOpen,
  onCloseMobileMenu,
  isLoadingChats,
  // Authentication props
  isAuthenticated,
  userStatus,
  onLogin,
  onRegister,
  onLogout,
  // Plan management props
  onOpenPlanSelection
}) => {
  const { isDark, toggleTheme } = useTheme();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isHelpSubmenuOpen, setIsHelpSubmenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 168) {
      return date.toLocaleDateString('sr-Latn-RS', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('sr-Latn-RS', { month: 'short', day: 'numeric' });
    }
  };

  // User account utility functions
  const getUserInitial = (email) => {
    if (!email) return 'U';
    return email.charAt(0).toUpperCase();
  };

  const getUserName = (email) => {
    if (!email) return 'Korisnik';
    // Extract name part before @ or use full email if short
    const namePart = email.split('@')[0];
    return namePart.length > 20 ? namePart.substring(0, 20) + '...' : namePart;
  };

  const getPlanLabel = (accessType, userStatus) => {
    // Handle both access_type and account_type for backward compatibility
    const planType = accessType || userStatus?.account_type;

    switch (planType) {
      case 'trial':
      case 'trial_unregistered':
      case 'trial_registered':
        return 'Probni period';
      case 'individual':
        return 'Individual';
      case 'professional':
        return 'Professional';
      case 'team':
        return 'Team';
      case 'premium':
        return 'Professional'; // Legacy premium users show as Professional
      default:
        return 'Free';
    }
  };

  const isTrialUser = (accessType, userStatus) => {
    const planType = accessType || userStatus?.account_type;
    return planType === 'trial' || planType === 'trial_unregistered' || planType === 'trial_registered';
  };

  const handleChatSelect = (chatId) => {
    onChatSelect(chatId);
    if (onCloseMobileMenu) {
      onCloseMobileMenu();
    }
  };

  const handleNewChat = () => {
    onNewChat();
    if (onCloseMobileMenu) {
      onCloseMobileMenu();
    }
  };

  // User menu handlers
  const toggleUserMenu = () => {
    setIsUserMenuOpen(!isUserMenuOpen);
  };

  const handleLogoutClick = () => {
    setIsUserMenuOpen(false);
    onLogout();
  };

  const handleUpgradePlan = () => {
    setIsUserMenuOpen(false);
    if (onOpenPlanSelection) {
      onOpenPlanSelection();
    }
  };

  const handleManagePlan = () => {
    setIsUserMenuOpen(false);
    if (onOpenPlanSelection) {
      onOpenPlanSelection();
    }
  };

  const toggleHelpSubmenu = () => {
    setIsHelpSubmenuOpen(!isHelpSubmenuOpen);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
        setIsHelpSubmenuOpen(false);
      }
    };

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
        setIsHelpSubmenuOpen(false);
      }
    };

    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isUserMenuOpen]);

  return (
    <div className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={handleNewChat}>
          <span className="icon">
            <Icon name="edit" size={18} />
          </span>
          Nova konverzacija
        </button>
        <div className="header-actions">
          <button className="icon-btn" onClick={toggleTheme} title={isDark ? 'Svetla tema' : 'Tamna tema'}>
            <span className="icon">
              <Icon name={isDark ? 'sun' : 'moon'} size={16} />
            </span>
          </button>
          <button className="icon-btn mobile-close-btn" onClick={onCloseMobileMenu} title="Zatvori meni">
            <span className="icon">
              <Icon name="x" size={16} />
            </span>
          </button>
        </div>
      </div>

      {/* Trial Status */}
      {userStatus && userStatus.access_type === 'trial' && userStatus.messages_remaining !== null && (
        <div className="trial-status-section">
          <div className="trial-status">
            <div className="trial-messages">
              <span className="messages-count">
                Probni period
              </span>
              <div className="messages-bar">
                <div 
                  className="messages-progress" 
                  style={{ 
                    width: `${((userStatus.messages_remaining || 0) / 5) * 100}%`
                  }}
                ></div>
              </div>
            </div>
            <div className="trial-time">
              <span className="trial-remaining">
                {`${userStatus.messages_remaining || 0} od 5 poruka preostalo`}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={`chat-list-container ${!isAuthenticated ? 'restricted' : ''}`}>
        <div className={`chat-list ${!isAuthenticated ? 'blurred' : ''}`}>
          {isLoadingChats ? (
            <ConversationsSkeleton />
          ) : chats.length === 0 ? (
            <div className="empty-state">
              <p>Nema prethodnih poruka</p>
              <p className="empty-subtitle">Pošaljite poruku da počnete</p>
            </div>
          ) : (
            chats.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${currentChatId === chat.id ? 'active' : ''} ${!isAuthenticated ? 'disabled' : ''} ${chat.isOptimistic ? 'optimistic' : ''}`}
                onClick={() => isAuthenticated ? handleChatSelect(chat.id) : null}
              >
                <div className="chat-content">
                  <div className="chat-title">{chat.title}</div>
                  <div className="chat-date">{formatDate(chat.updated_at)}</div>
                </div>
                <button
                  className="delete-chat-btn"
                  onClick={(e) => {
                    if (!isAuthenticated) return;
                    e.stopPropagation();
                    onDeleteChat(chat.id);
                  }}
                  title={isAuthenticated ? "Obriši konverzaciju" : "Registrujte se za upravljanje konverzacijama"}
                  disabled={!isAuthenticated}
                >
                  <Icon name="trash2" size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Overlay for unregistered users */}
        {!isAuthenticated && (
          <div className="chat-history-overlay">
            <div className="overlay-content">
              <h3>Istorija razgovora</h3>
              <p>Registrujte se da biste pristupili prethodnim konverzacijama.</p>
              <div className="overlay-buttons">
                <button className="overlay-btn primary" onClick={onRegister}>
                  Registracija
                </button>
                <button className="overlay-btn secondary" onClick={onLogin}>
                  Prijava
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* User Account Section */}
      {isAuthenticated && userStatus && (
        <div className="user-account-section" ref={userMenuRef}>
          <button className="user-account-button" onClick={toggleUserMenu}>
            <div className="user-avatar">
              {getUserInitial(userStatus.email)}
            </div>
            <div className="user-info-details">
              <div className="user-name">{userStatus.email || 'Korisnik'}</div>
              <div className="user-plan">{getPlanLabel(userStatus.access_type, userStatus)}</div>
            </div>
            <div className={`dropdown-arrow ${isUserMenuOpen ? 'open' : ''}`}>
              <Icon name="chevronDown" size={12} />
            </div>
          </button>
          
          {isUserMenuOpen && (
            <div className="user-dropdown-menu">
              {isTrialUser(userStatus.access_type, userStatus) ? (
                <button className="dropdown-menu-item upgrade-item" onClick={handleUpgradePlan}>
                  <span className="menu-icon">
                    <Icon name="arrowUp" size={14} />
                  </span>
                  Nadogradite plan
                </button>
              ) : (
                <button className="dropdown-menu-item manage-item" onClick={handleManagePlan}>
                  <span className="menu-icon">
                    <Icon name="settings" size={14} />
                  </span>
                  Izmenite Plan
                </button>
              )}
              <div className="dropdown-menu-item help-item" 
                   onMouseEnter={() => setIsHelpSubmenuOpen(true)}
                   onMouseLeave={() => setIsHelpSubmenuOpen(false)}
                   onClick={toggleHelpSubmenu}>
                <div className="help-item-content">
                  <span className="menu-icon">
                    <Icon name="helpCircle" size={14} />
                  </span>
                  Pomoć
                </div>
                <span className={`submenu-arrow ${isHelpSubmenuOpen ? 'open' : ''}`}>
                  <Icon name="chevronRight" size={12} />
                </span>
                {isHelpSubmenuOpen && (
                  <div className="help-submenu-popup">
                    <a 
                      href="https://normaai.rs/uslovi.html" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="submenu-link"
                    >
                      Uslovi korišćenja
                    </a>
                    <a 
                      href="https://normaai.rs/privatnost.html" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="submenu-link"
                    >
                      Politika privatnosti
                    </a>
                  </div>
                )}
              </div>
              <button className="dropdown-menu-item logout-item" onClick={handleLogoutClick}>
                <span className="menu-icon">
                  <Icon name="logOut" size={14} />
                </span>
                Odjavite se
              </button>
            </div>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        <div className="app-info">
          <h3>Norma AI</h3>
          <p>Pravni asistent za srpsko zakonodavstvo</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;