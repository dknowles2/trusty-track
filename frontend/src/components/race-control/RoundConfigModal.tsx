import React, { useState } from 'react';
import Modal from '../Modal';

interface RoundConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (schedulingStrategy: string) => Promise<void>;
}

export const RoundConfigModal: React.FC<RoundConfigModalProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [schedulingStrategy, setSchedulingStrategy] = useState('LANE_ROTATION');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(schedulingStrategy);
      onClose();
    } catch (error) {
      console.error('Failed to create round:', error);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px',
    fontSize: '1rem',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxSizing: 'border-box' as const
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: 'bold' as const,
    color: '#333'
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Round">
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={labelStyle}>Scheduling Strategy</label>
          <select 
            value={schedulingStrategy} 
            onChange={e => setSchedulingStrategy(e.target.value)}
            style={inputStyle}
            disabled={loading}
          >
            <option value="LANE_ROTATION">Lane Rotation (Perfect N)</option>
            <option value="PPC">Partial Perfect Chart (PPC)</option>
          </select>
          <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
            {schedulingStrategy === 'LANE_ROTATION' && "Each racer runs once in every lane. Best for fairness."}
            {schedulingStrategy === 'PPC' && "High social variety; racers face many different opponents."}
          </p>
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
