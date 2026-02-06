import React, { useState } from 'react';
import Modal from '../Modal';

interface RoundConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (schedulingStrategy: string, name?: string) => Promise<void>;
  currentRoundCount: number;  // Number of existing rounds
}

export const RoundConfigModal: React.FC<RoundConfigModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  currentRoundCount
}) => {
  const [schedulingStrategy, setSchedulingStrategy] = useState('LANE_ROTATION');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(schedulingStrategy, name);
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

            {/* Stearns Option - Only available after Round 1 */}
            <label style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              padding: '12px', 
              border: schedulingStrategy === 'STEARNS' ? '2px solid var(--scouting-blue)' : '2px solid #ddd',
              borderRadius: '8px',
              cursor: currentRoundCount > 0 ? 'pointer' : 'not-allowed',
              backgroundColor: schedulingStrategy === 'STEARNS' ? '#f0f7ff' : (currentRoundCount > 0 ? '#fff' : '#f5f5f5'),
              opacity: currentRoundCount > 0 ? 1 : 0.6,
              transition: 'all 0.2s'
            }}>
              <input 
                type="radio" 
                name="schedulingStrategy"
                value="STEARNS"
                checked={schedulingStrategy === 'STEARNS'}
                onChange={e => setSchedulingStrategy(e.target.value)}
                disabled={loading || currentRoundCount === 0}
                style={{ marginTop: '3px', marginRight: '10px', cursor: currentRoundCount > 0 ? 'pointer' : 'not-allowed' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>
                  Stearns Method (Speed-Based)
                  {currentRoundCount === 0 && <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#999', marginLeft: '8px' }}>⚠️ Requires Round 1</span>}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  Balanced heats using Round 1 times. Groups racers by speed for competitive racing.
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
