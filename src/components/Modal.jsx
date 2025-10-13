import React from 'react';
import Icon from './Icons';
import './Modal.css';

const Modal = ({ isOpen, onClose, title, children, type = 'default' }) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  React.useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Check if it's a full-screen modal type
  const isFullScreenModal = ['auth', 'plan-selection', 'template-library'].includes(type);

  return (
    <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onClick={handleBackdropClick}>
      <div className={`modal-content ${type}`}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close-btn" onClick={onClose}>
            {isFullScreenModal ? (
              <Icon name="chevronLeft" size={20} className="modal-back-icon" />
            ) : null}
            <span className="modal-close-x">✕</span>
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;