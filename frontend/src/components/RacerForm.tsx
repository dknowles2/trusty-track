import { useState, useEffect } from 'react';
import CameraCapture from './CameraCapture';

export interface RacerData {
  first_name: string;
  last_name: string;
  car_number?: number;
  rank: string;
  car_passed_inspection: boolean;
  racer_image_url?: string;
  car_image_url?: string;
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
  const [showCamera, setShowCamera] = useState<'none' | 'racer' | 'car'>('none');

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

  const uploadFile = async (file: File, type: 'racer' | 'car') => {
      const data = new FormData();
      data.append('file', file);
      
      try {
          const response = await fetch('http://127.0.0.1:8000/upload/', {
              method: 'POST',
              body: data
          });
          if (response.ok) {
              const result = await response.json();
              setFormData(prev => ({ 
                  ...prev, 
                  [type === 'racer' ? 'racer_image_url' : 'car_image_url']: result.url 
              }));
          }
      } catch (error) {
          console.error("Upload failed", error);
      }
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

        <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Racer Image Upload */}
            <div>
                <label style={{ display: 'block', marginBottom: '5px' }}>Racer Photo</label>
                {formData.racer_image_url && (
                    <img src={formData.racer_image_url} alt="Racer" style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block', marginBottom: '5px', borderRadius: '4px', backgroundColor: '#eee' }} />
                )}
                <div style={{ display: 'flex', gap: '5px' }}>
                    <input 
                        type="file" 
                        accept="image/*"
                        style={{ width: '0.1px', height: '0.1px', opacity: 0, overflow: 'hidden', position: 'absolute', zIndex: -1 }}
                        id="racer-file"
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                uploadFile(e.target.files[0], 'racer');
                            }
                        }}
                    />
                    <label htmlFor="racer-file" className="secondary-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '5px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                         Upload File
                    </label>
                    <button 
                        type="button" 
                        className="secondary-btn"
                        onClick={() => setShowCamera('racer')}
                        style={{ flex: 1, padding: '5px', fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                        📷 Camera
                    </button>
                </div>
            </div>
             {/* Car Image Upload */}
             <div>
                <label style={{ display: 'block', marginBottom: '5px' }}>Car Photo</label>
                {formData.car_image_url && (
                    <img src={formData.car_image_url} alt="Car" style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block', marginBottom: '5px', borderRadius: '4px', backgroundColor: '#eee' }} />
                )}
                <div style={{ display: 'flex', gap: '5px' }}>
                    <input 
                        type="file" 
                        accept="image/*"
                        style={{ width: '0.1px', height: '0.1px', opacity: 0, overflow: 'hidden', position: 'absolute', zIndex: -1 }}
                        id="car-file"
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                uploadFile(e.target.files[0], 'car');
                            }
                        }}
                    />
                    <label htmlFor="car-file" className="secondary-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '5px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                         Upload File
                    </label>
                    <button 
                        type="button" 
                        className="secondary-btn"
                        onClick={() => setShowCamera('car')}
                        style={{ flex: 1, padding: '5px', fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                        📷 Camera
                    </button>
                </div>
            </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={loading} className="primary-btn" style={{ fontSize: '0.9rem', padding: '8px 16px' }}>
            {loading ? 'Saving...' : 'Save Racer'}
          </button>
        </div>
      </form>
      
      {showCamera !== 'none' && (
          <CameraCapture 
            onClose={() => setShowCamera('none')}
            onCapture={(file) => {
                uploadFile(file, showCamera as 'racer' | 'car');
                setShowCamera('none');
            }}
          />
      )}
    </div>
  );
}
