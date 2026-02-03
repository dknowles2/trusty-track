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
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Lane Rotation Option */}
            <label style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              padding: '12px', 
              border: schedulingStrategy === 'LANE_ROTATION' ? '2px solid var(--scouting-blue)' : '2px solid #ddd',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: schedulingStrategy === 'LANE_ROTATION' ? '#f0f7ff' : '#fff',
              transition: 'all 0.2s'
            }}>
              <input 
                type="radio" 
                name="schedulingStrategy"
                value="LANE_ROTATION"
                checked={schedulingStrategy === 'LANE_ROTATION'}
                onChange={e => setSchedulingStrategy(e.target.value)}
                disabled={loading}
                style={{ marginTop: '3px', marginRight: '10px', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>
                  Lane Rotation (Perfect N)
                </div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  Each racer runs once in every lane. Best for fairness.
                </div>
              </div>
            </label>

            {/* PPC Option */}
            <label style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              padding: '12px', 
              border: schedulingStrategy === 'PPC' ? '2px solid var(--scouting-blue)' : '2px solid #ddd',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: schedulingStrategy === 'PPC' ? '#f0f7ff' : '#fff',
              transition: 'all 0.2s'
            }}>
              <input 
                type="radio" 
                name="schedulingStrategy"
                value="PPC"
                checked={schedulingStrategy === 'PPC'}
                onChange={e => setSchedulingStrategy(e.target.value)}
                disabled={loading}
                style={{ marginTop: '3px', marginRight: '10px', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>
                  Partial Perfect Chart (PPC)
                </div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  High social variety; racers face many different opponents.
                </div>
              </div>
            </label>
          </div>
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
