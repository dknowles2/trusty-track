import { useState, useEffect } from 'react';

export interface RacerData {
  first_name: string;
  last_name: string;
  car_number?: number;
  rank: string;
  car_passed_inspection: boolean;
}

interface RacerFormProps {
  initialData?: RacerData;
  onSubmit: (data: RacerData) => Promise<void>;
  onCancel: () => void;
}

export default function RacerForm({ initialData, onSubmit, onCancel }: RacerFormProps) {
  const [formData, setFormData] = useState<RacerData>({
    first_name: '',
    last_name: '',
    car_number: undefined,
    rank: 'BEAR',
    car_passed_inspection: false
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : 
               name === 'car_number' ? parseInt(value) || undefined : value
    }));
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

  return (
    <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
      <h3>{initialData ? 'Edit Racer' : 'Add New Racer'}</h3>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '5px' }}>First Name</label>
            <input
              type="text"
              name="first_name"
              value={formData.first_name}
              onChange={handleChange}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
            />
          </div>
          <div>
             <label style={{ display: 'block', marginBottom: '5px' }}>Last Name</label>
             <input
               type="text"
               name="last_name"
               value={formData.last_name}
               onChange={handleChange}
               required
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             />
          </div>
        </div>

        <div style={{ marginBottom: '10px' }}>
             <label style={{ display: 'block', marginBottom: '5px' }}>Car Number</label>
             <input
               type="number"
               name="car_number"
               value={formData.car_number || ''}
               onChange={handleChange}
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             />
        </div>

        <div style={{ marginBottom: '10px' }}>
             <label style={{ display: 'block', marginBottom: '5px' }}>Rank</label>
             <select
               name="rank"
               value={formData.rank}
               onChange={handleChange}
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             >
                <option value="LION">Lion</option>
                <option value="TIGER">Tiger</option>
                <option value="WOLF">Wolf</option>
                <option value="BEAR">Bear</option>
                <option value="WEBELOS">Webelos</option>
                <option value="ARROW_OF_LIGHT">Arrow of Light</option>
                <option value="OTHER">Other</option>
             </select>
        </div>
        
        <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                    type="checkbox"
                    name="car_passed_inspection"
                    checked={formData.car_passed_inspection}
                    onChange={handleChange}
                    style={{ marginRight: '10px' }}
                />
                Passed Inspection / Checked In
            </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={loading} className="primary-btn" style={{ fontSize: '0.9rem', padding: '8px 16px' }}>
            {loading ? 'Saving...' : 'Save Racer'}
          </button>
        </div>
      </form>
    </div>
  );
}
