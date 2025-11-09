import React from 'react';
import Modal from './Modal';

const InfoDialog = ({
  isOpen,
  onClose,
  title = 'Informacija',
  message,
  buttonText = 'U redu'
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} type="confirm">
      <div className="info-message">
        {message}
      </div>
      <div className="confirm-actions">
        <button className="confirm-btn primary" onClick={onClose}>
          {buttonText}
        </button>
      </div>
    </Modal>
  );
};

export default InfoDialog;
