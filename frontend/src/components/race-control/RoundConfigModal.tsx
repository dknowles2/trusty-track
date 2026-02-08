import React, { useState } from 'react';
import Modal from '../Modal';

interface RoundConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (schedulingStrategy: string, name?: string) => Promise<void>;
}

export const RoundConfigModal: React.FC<RoundConfigModalProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {

  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit('PPC', name);
      onClose();
    } catch (error) {
      console.error('Failed to create round:', error);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: 'bold' as const,
    color: '#333'
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    fontSize: '1rem',
    marginBottom: '1rem'
  };


  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Round">
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="roundName" style={labelStyle}>Round Name (Optional)</label>
          <input
            id="roundName"
            type="text"
            placeholder="e.g. Semi-Finals"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            disabled={loading}
          />
        </div>



        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button 
            type="button" 
            onClick={onClose} 
            className="secondary-btn"
            disabled={loading}
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="primary-btn"
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Round & Generate Heats'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
