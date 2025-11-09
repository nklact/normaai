import React from 'react';
import Modal from './Modal';

const AccountDeletionSuccessDialog = ({
  isOpen,
  onClose,
  title = 'Nalog obrisan',
  message,
  buttonText = 'U redu'
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} type="confirm">
      <div className="success-message">
        {message}
      </div>
      <div className="confirm-actions">
        <button className="confirm-btn delete" onClick={onClose}>
          {buttonText}
        </button>
      </div>
    </Modal>
  );
};

export default AccountDeletionSuccessDialog;
