import { useState, useEffect } from 'react';
import CameraCapture from './CameraCapture';
import { useQuery, useMutation } from 'urql';
import { GET_RACE_DENS, UPLOAD_IMAGE } from '../graphql/raceDetails';

export interface RacerData {
  first_name: string;
  last_name: string;
  car_number?: number;
  den_id?: number;
  car_name?: string;
  car_passed_inspection: boolean;
  car_weight?: number;
  racer_image_url?: string;
  car_image_url?: string;
}

export interface Den {
    id: number;
    name: string;
    color: string;
    rank?: string;
    car_number_range_start?: number;
    car_number_range_end?: number;
}

interface RacerFormProps {
  initialData?: RacerData;
  raceId?: number;
  onSubmit: (data: RacerData) => Promise<void>;
  onCancel: () => void;
}

export default function RacerForm({ initialData, raceId, onSubmit, onCancel }: RacerFormProps) {
  const [formData, setFormData] = useState<RacerData>({
    first_name: '',
    last_name: '',
    car_number: undefined,
    den_id: undefined,
    car_passed_inspection: false,
    car_weight: undefined,
    car_name: ''
  });
  
  // Use GraphQL to fetch dens
  const [densResult] = useQuery({
      query: GET_RACE_DENS,
      variables: { raceId: raceId || 0 },
      pause: !raceId
  });

  const dens: Den[] = densResult.data?.race?.dens || [];
  
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState<'none' | 'racer' | 'car'>('none');
  const [, uploadImageMutation] = useMutation(UPLOAD_IMAGE);

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
               name === 'car_number' || name === 'den_id' ? parseInt(value) || undefined : 
               name === 'car_weight' ? parseFloat(value) || undefined : value
    }));
  };

  const uploadFile = async (file: File, type: 'racer' | 'car') => {
      const reader = new FileReader();
      reader.onload = async (e) => {
          const dataUrl = e.target?.result as string;
          try {
              const result = await uploadImageMutation({ dataUrl });
              if (result.error) throw result.error;
              const url = result.data?.uploadImage;
              setFormData(prev => ({
                  ...prev,
                  [type === 'racer' ? 'racer_image_url' : 'car_image_url']: url
              }));
          } catch (error) {
              console.error('Upload failed', error);
          }
      };
      reader.readAsDataURL(file);
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
                 <label style={{ display: 'block', marginBottom: '5px' }}>Car Number</label>
                 <input
                   type="number"
                   name="car_number"
                   value={formData.car_number || ''}
                   onChange={handleChange}
                   style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                 />
            </div>
            <div>
                 <label style={{ display: 'block', marginBottom: '5px' }}>Car Weight (oz)</label>
                 <input
                   type="number"
                   step="0.01"
                   name="car_weight"
                   value={formData.car_weight || ''}
                   onChange={handleChange}
                   placeholder="e.g. 5.0"
                   style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                 />
            </div>
        </div>

        <div style={{ marginBottom: '10px' }}>
             <label style={{ display: 'block', marginBottom: '5px' }}>Car Name</label>
             <input
               type="text"
               name="car_name"
               value={formData.car_name || ''}
               onChange={handleChange}
               placeholder="e.g. Blue Streak"
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             />
        </div>

        <div style={{ marginBottom: '10px' }}>
             <label style={{ display: 'block', marginBottom: '5px' }}>Den</label>
             <select
               name="den_id"
               value={formData.den_id || ''}
               onChange={handleChange}
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             >
                <option value="">Select a Den...</option>
                {dens.map((den: Den) => (
                    <option key={den.id} value={den.id}>{den.name}</option>
                ))}
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
