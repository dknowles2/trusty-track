import React, { useState, useEffect } from 'react';

export interface RaceFormData {
    name: string;
    date_time: string;
    location: string;
    group_id?: number;
    scheduling_strategy: string;
    scoring_strategy: string;
    car_numbering_strategy: string;
}

interface RaceFormProps {
    initialData?: Partial<RaceFormData>;
    onSubmit: (data: RaceFormData) => Promise<void>;
    onCancel: () => void;
    submitLabel?: string;
}

export default function RaceForm({ initialData, onSubmit, onCancel, submitLabel = 'Save' }: RaceFormProps) {
    const [formData, setFormData] = useState<RaceFormData>({
        name: '',
        date_time: '',
        location: '',
        group_id: 1, // Default
        scheduling_strategy: 'LANE_ROTATION',
        scoring_strategy: 'TIMED',
        car_numbering_strategy: 'MANUAL',
        ...initialData
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (initialData) {
            setFormData(prev => ({ ...prev, ...initialData }));
        }
    }, [initialData]);

    const handleChange = (field: keyof RaceFormData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSubmit(formData);
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%',
        padding: '10px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        fontSize: '1rem',
        marginBottom: '1rem',
        boxSizing: 'border-box' as const
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.9rem',
        marginBottom: '0.5rem',
        color: '#555',
        fontWeight: 'bold'
    };

    return (
        <form onSubmit={handleSubmit}>
            <div>
                <label style={labelStyle}>Event Name</label>
                <input 
                    type="text" 
                    value={formData.name} 
                    onChange={e => handleChange('name', e.target.value)}
                    placeholder="e.g. 2024 Pinewood Derby"
                    required
                    style={inputStyle}
                />
            </div>
            <div>
                <label style={labelStyle}>Date & Time</label>
                <input 
                    type="datetime-local" 
                    value={formData.date_time} 
                    onChange={e => handleChange('date_time', e.target.value)}
                    style={inputStyle}
                />
            </div>
            <div>
                <label style={labelStyle}>Location</label>
                <input 
                    type="text" 
                    value={formData.location} 
                    onChange={e => handleChange('location', e.target.value)}
                    placeholder="e.g. School Gym"
                    style={inputStyle}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                    <label style={labelStyle}>Scheduling</label>
                    <select 
                        value={formData.scheduling_strategy} 
                        onChange={e => handleChange('scheduling_strategy', e.target.value)}
                        style={inputStyle}
                    >
                        <option value="LANE_ROTATION">Lane Rotation</option>
                        <option value="PERFECT_N">Perfect N</option>
                        <option value="CHAOTIC">Chaotic</option>
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Scoring</label>
                    <select 
                        value={formData.scoring_strategy} 
                        onChange={e => handleChange('scoring_strategy', e.target.value)}
                        style={inputStyle}
                    >
                        <option value="TIMED">Timed</option>
                        <option value="POINTS">Points</option>
                    </select>
                </div>
            </div>
             <div>
                <label style={labelStyle}>Car Numbering</label>
                <select 
                    value={formData.car_numbering_strategy} 
                    onChange={e => handleChange('car_numbering_strategy', e.target.value)}
                    style={inputStyle}
                >
                    <option value="MANUAL">Manual</option>
                    <option value="PER_GROUP">Per Group</option>
                    <option value="GLOBAL">Global</option>
                </select>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                <button type="submit" disabled={loading} className="primary-btn" style={{ flex: 1, padding: '12px' }}>
                    {loading ? 'Saving...' : submitLabel}
                </button>
                <button 
                    type="button" 
                    onClick={onCancel} 
                    className="secondary-btn"
                    style={{ background: 'transparent', border: '1px solid #ddd', color: '#666' }}
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
