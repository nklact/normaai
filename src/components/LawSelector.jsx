import React from 'react';
import Icon from './Icons';
import logo from '../assets/logo.svg';
import logoWhite from '../assets/logo-w.svg';
import './LawSelector.css';

const LawSelector = ({ onToggleMobileMenu, isAuthenticated, onLogin, onRegister, onNewConversation }) => {
  return (
    <div className="law-selector">
      <div className="law-selector-header">
        <button 
          className="mobile-menu-btn"
          onClick={onToggleMobileMenu}
          aria-label="Otvori meni"
        >
          <Icon name="menu" size={18} />
        </button>
        <div className="law-selector-label">
          <img 
            src={logo} 
            alt="Norma AI" 
            className="app-logo light-logo" 
          />
          <img 
            src={logoWhite} 
            alt="Norma AI" 
            className="app-logo dark-logo" 
          />
        </div>
        {isAuthenticated && (
          <button 
            className="new-conversation-btn"
            onClick={onNewConversation}
            aria-label="Nova konverzacija"
            title="Nova konverzacija"
          >
            <Icon name="edit" size={18} />
          </button>
        )}
        {!isAuthenticated && (
          <div className="law-selector-auth-m">
            <button className="law-auth-btn" onClick={onLogin}>
              Prijava
            </button>
            <button className="law-auth-btn primary" onClick={onRegister}>
              Registracija
            </button>
          </div>
        )}
      </div>
      {!isAuthenticated && (
        <div className="law-selector-auth">
          <button className="law-auth-btn" onClick={onLogin}>
            Prijava
          </button>
          <button className="law-auth-btn primary" onClick={onRegister}>
            Registracija
          </button>
        </div>
      )}
    </div>
  );
};

export default LawSelector;