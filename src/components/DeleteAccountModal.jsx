import React, { useState } from 'react';
import Modal from './Modal';
import './Modal.css';

const DeleteAccountModal = ({ isOpen, onClose, onConfirm, requirePassword, userEmail }) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (confirmation !== 'POTVRDI') {
      setError('Molimo unesite POTVRDI da biste potvrdili');
      return;
    }

    if (requirePassword && !password) {
      setError('Lozinka je obavezna');
      return;
    }

    setLoading(true);

    try {
      await onConfirm(requirePassword ? password : null);
      // Close modal on success
      onClose();
    } catch (err) {
      // Parse error message from backend
      let errorMessage = 'Greška prilikom brisanja naloga';

      try {
        const errorData = JSON.parse(err.message);
        errorMessage = errorData.message || errorMessage;
      } catch {
        // If not JSON, use the error message as is
        errorMessage = err.message || errorMessage;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setPassword('');
      setConfirmation('');
      setError('');
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="⚠️ Brisanje Naloga"
      type="confirm"
    >
      <div className="delete-warning">
        <p><strong>Ova akcija će:</strong></p>
        <ul>
          <li>Označiti vaš nalog za brisanje</li>
          <li>Otkazati sve aktivne pretplate</li>
          <li>Onemogućiti pristup svim funkcijama</li>
          <li>Zakazati trajno brisanje za 30 dana</li>
        </ul>

        <p className="grace-period-notice">
          <strong>Period oporavka:</strong> Imate 30 dana da se prijavite i vratite nalog.
          Nakon 30 dana, vaš nalog i svi podaci će biti trajno obrisani.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {requirePassword && (
          <div className="form-group">
            <label htmlFor="password" className="form-label">Potvrdite lozinku</label>
            <input
              type="password"
              id="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Unesite vašu lozinku"
              disabled={loading}
              autoComplete="current-password"
            />
          </div>
        )}

        <div className="form-group">
          <label htmlFor="confirmation" className="form-label">
            Unesite <strong>POTVRDI</strong> da potvrdite
          </label>
          <input
            type="text"
            id="confirmation"
            className="form-input"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="POTVRDI"
            disabled={loading}
            autoComplete="off"
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="confirm-actions">
          <button
            type="button"
            className="confirm-btn cancel"
            onClick={handleClose}
            disabled={loading}
          >
            Otkaži
          </button>
          <button
            type="submit"
            className="confirm-btn delete"
            disabled={loading || confirmation !== 'POTVRDI'}
          >
            {loading ? 'Brisanje...' : 'Obriši nalog'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default DeleteAccountModal;
