import React, { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';
import Icon from '@mdi/react';
import { mdiFlagCheckered, mdiAccountGroup, mdiInformation } from '@mdi/js';

interface RoundConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (config: {
    name: string;
    schedulingStrategy: string;
    advancementSource?: string;
    advancementNumRacers?: number;
    runsPerLane: number;
    generalType?: string;
  }) => Promise<void>;
  racerCount: number;
  denCount: number;
  championshipTrophies: number;
  hasGeneralRound: boolean;
}

export const RoundConfigModal: React.FC<RoundConfigModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  racerCount,
  denCount,
  championshipTrophies,
  hasGeneralRound
}) => {
  const [type, setType] = useState<'GENERAL' | 'CHAMPIONSHIP'>('GENERAL');
  const [generalType, setGeneralType] = useState<'PACK' | 'DEN'>('PACK');
  const [name, setName] = useState('');
  const [source, setSource] = useState<'PACK' | 'DEN'>('PACK');
  const [numTopRacers, setNumTopRacers] = useState(championshipTrophies);
  const [runsPerLane, setRunsPerLane] = useState(1);
  const [loading, setLoading] = useState(false);

  // Reset name when type changes
  useEffect(() => {
    if (type === 'CHAMPIONSHIP') {
      setName('Championship Round');
    } else {
      setName('');
    }
  }, [type]);

  // If general round is deleted while modal is open (unlikely but possible), switch away from championship
  useEffect(() => {
    if (!hasGeneralRound && type === 'CHAMPIONSHIP') {
      setType('GENERAL');
    }
  }, [hasGeneralRound, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit({
        name,
        schedulingStrategy: 'PPC',
        advancementSource: type === 'CHAMPIONSHIP' ? source : undefined,
        advancementNumRacers: type === 'CHAMPIONSHIP' ? numTopRacers : undefined,
        runsPerLane,
        generalType: type === 'GENERAL' ? generalType : undefined
      });
      onClose();
    } catch (error) {
      console.error('Failed to create round:', error);
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: 'bold',
    fontSize: '0.9rem',
    color: '#333'
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    fontSize: '1rem'
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px',
    textAlign: 'center',
    cursor: 'pointer',
    borderBottom: active ? '3px solid var(--scouting-blue)' : '3px solid transparent',
    fontWeight: active ? 'bold' : 'normal',
    color: active ? 'var(--scouting-blue)' : '#666',
    transition: 'all 0.2s',
    background: active ? '#f0f7ff' : 'none'
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Round" maxWidth="500px">
      <form onSubmit={handleSubmit}>
        {/* Type Tabs */}
        <div style={{ display: 'flex', marginBottom: '20px', borderBottom: '1px solid #eee' }}>
          <div style={tabStyle(type === 'GENERAL')} onClick={() => setType('GENERAL')}>
            General Round
          </div>
          <div 
            style={{
              ...tabStyle(type === 'CHAMPIONSHIP'),
              opacity: hasGeneralRound ? 1 : 0.5,
              cursor: hasGeneralRound ? 'pointer' : 'not-allowed'
            }} 
            onClick={() => {
              if (hasGeneralRound) {
                setType('CHAMPIONSHIP');
              }
            }}
            title={!hasGeneralRound ? "Schedule at least one general round first" : ""}
          >
            Championship Round
          </div>
        </div>

        {!hasGeneralRound && type === 'CHAMPIONSHIP' && (
           <div style={{ padding: '10px', background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '4px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
             <Icon path={mdiInformation} size={0.7} color="#f57c00" />
             Championship rounds require an existing general round as a source.
           </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '25px' }}>
          {/* Round Name */}
          <div>
            <label htmlFor="roundName" style={labelStyle}>Round Name</label>
            <input
              id="roundName"
              type="text"
              placeholder={type === 'GENERAL' ? "e.g. Quality Round" : "e.g. Finals"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          {type === 'GENERAL' ? (
            <>
              {/* General Type (PACK/DEN) */}
              <div>
                <label style={labelStyle}>Format</label>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={generalType === 'PACK'}
                      onChange={() => setGeneralType('PACK')}
                      disabled={loading}
                    />
                    <span>
                      <Icon path={mdiFlagCheckered} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      PACK
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={generalType === 'DEN'}
                      onChange={() => setGeneralType('DEN')}
                      disabled={loading}
                    />
                    <span>
                      <Icon path={mdiAccountGroup} size={0.7} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                      DEN
                    </span>
                  </label>
                </div>
                {generalType === 'DEN' && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                    Will create {denCount} rounds (one per den).
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Championship Config */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div>
                  <label style={labelStyle}>Top performers from</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as 'PACK' | 'DEN')}
                    style={inputStyle}
                    disabled={loading}
                  >
                    <option value="PACK">PACK (Overall)</option>
                    <option value="DEN">DEN (Each Den)</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Number to pick</label>
                  <input
                    type="number"
                    min={championshipTrophies}
                    max={racerCount}
                    value={numTopRacers}
                    onChange={(e) => setNumTopRacers(Math.max(championshipTrophies, parseInt(e.target.value) || 1))}
                    style={inputStyle}
                    disabled={loading}
                  />
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#666', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Icon path={mdiInformation} size={0.6} color="#666" />
                Minimum pick count ({championshipTrophies}) enforced by trophy config.
              </div>
            </>
          )}

          {/* Runs Per Lane */}
          <div style={{ width: '50%' }}>
            <label style={labelStyle}>Runs per lane</label>
            <input
              type="number"
              min="1"
              max="10"
              value={runsPerLane}
              onChange={(e) => setRunsPerLane(parseInt(e.target.value) || 1)}
              style={inputStyle}
              disabled={loading}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #eee', paddingTop: '20px' }}>
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
            disabled={loading || racerCount < 2}
          >
            {loading ? 'Creating...' : 'Create Round(s) & Generate Heats'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
