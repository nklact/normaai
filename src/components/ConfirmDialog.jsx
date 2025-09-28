import React from 'react';
import Modal from './Modal';

const ConfirmDialog = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = 'Potvrdi', 
  cancelText = 'Otkaži',
  type = 'danger' 
}) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} type="confirm">
      <div className="confirm-message">
        {message}
      </div>
      <div className="confirm-actions">
        <button className="confirm-btn cancel" onClick={onClose}>
          {cancelText}
        </button>
        <button className={`confirm-btn ${type}`} onClick={handleConfirm}>
          {confirmText}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;