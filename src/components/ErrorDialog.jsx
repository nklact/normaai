import React from 'react';
import Modal from './Modal';

const ErrorDialog = ({ 
  isOpen, 
  onClose, 
  title = 'Greška', 
  message, 
  buttonText = 'U redu' 
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} type="error">
      <div className="error-message">
        {message}
      </div>
      <div className="error-actions">
        <button className="error-btn" onClick={onClose}>
          {buttonText}
        </button>
      </div>
    </Modal>
  );
};

export default ErrorDialog;