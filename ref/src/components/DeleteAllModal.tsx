import React, { useState, useRef } from 'react';

interface DeleteAllModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  conversationCount: number;
}

export function DeleteAllModal({ isOpen, onClose, onConfirm, conversationCount }: DeleteAllModalProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canConfirm = input.trim().toUpperCase() === 'DELETE';

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-all-title" onClick={onClose}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()} aria-describedby="confirm-delete-all-desc">
        <div className="confirm-header">
          <div className="confirm-title">
            <svg className="confirm-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 9v4m0 4h.01M10.29 3.86l-7.5 12.99A1 1 0 0 0 3.65 19h16.7a1 1 0 0 0 .86-1.15l-3.1-13A1 1 0 0 0 17.16 4H6.84a1 1 0 0 0-.55.16z"/>
            </svg>
            <h2 id="confirm-delete-all-title">Delete All Chats</h2>
          </div>
          <button
            className="confirm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="confirm-body">
          <div className="confirm-warning" role="alert" id="confirm-delete-all-desc">
            <strong>Warning:</strong> This will permanently remove all {conversationCount} chat{conversationCount === 1 ? '' : 's'} stored in this browser. This cannot be undone.
          </div>
          <div className="confirm-instruction">
            <label htmlFor="confirm-delete-input">
              To confirm, type <span className="confirm-token">DELETE</span> below.
            </label>
            <input
              id="confirm-delete-input"
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-invalid={input.length > 0 && !canConfirm}
              className="confirm-input"
              placeholder="DELETE"
            />
            <div className="confirm-hint">Only chats on this device will be deleted.</div>
          </div>
        </div>
        <div className="confirm-actions">
          <button
            className="button ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Delete All
          </button>
        </div>
      </div>
    </div>
  );
}