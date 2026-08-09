import { useRef, useState } from 'react';
import CameraCapture from '../../../components/ui/CameraCapture';
import { useQuery, useMutation } from 'urql';
import { GET_RACE_DENS, UPLOAD_IMAGE } from '../graphql/queries';
import { carryOver } from '../racerEntry';

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
  submitLabel?: string;
  /**
   * Save and stay open for the next racer (#202).
   *
   * Only supplied when adding. Editing one racer has no "another" to go on to,
   * and check-in is a different act again.
   */
  onSubmitAndContinue?: (data: RacerData) => Promise<void>;
}

export default function RacerForm({ initialData, raceId, onSubmit, onCancel, submitLabel, onSubmitAndContinue }: RacerFormProps) {
  // Seeded from the racer being edited, rather than emptied and then patched
  // by an effect. The form lives in a modal that unmounts when it closes, so a
  // fresh mount is a fresh form; the caller also keys it, so switching racers
  // without closing would still start clean.
  const [formData, setFormData] = useState<RacerData>(initialData ?? {
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
  // Where the cursor goes after "Save and add another": without this the focus
  // sits on a button and the next name has to be reached for with the mouse,
  // which is most of what the button was meant to save.
  const firstNameRef = useRef<HTMLInputElement>(null);
  const [, uploadImageMutation] = useMutation(UPLOAD_IMAGE);

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

  // Save, then hand the form back empty but for the den (#202). The reset only
  // happens on success: throwing away what the operator typed because the save
  // failed is how sixty entries become sixty-one.
  const handleSubmitAndContinue = async () => {
    if (!onSubmitAndContinue) return;
    setLoading(true);
    try {
      await onSubmitAndContinue(formData);
      setFormData(carryOver(formData));
      firstNameRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <div>
            <label htmlFor="racer-first-name" style={{ display: 'block', marginBottom: '5px' }}>First Name</label>
            <input
              type="text"
              name="first_name"
               id="racer-first-name"
              ref={firstNameRef}
              value={formData.first_name}
              onChange={handleChange}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
            />
          </div>
          <div>
             <label htmlFor="racer-last-name" style={{ display: 'block', marginBottom: '5px' }}>Last Name</label>
             <input
               type="text"
               name="last_name"
               id="racer-last-name"
               value={formData.last_name}
               onChange={handleChange}
               required
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
                 <label htmlFor="racer-car-number" style={{ display: 'block', marginBottom: '5px' }}>Car Number</label>
                 <input
                   type="number"
                   name="car_number"
               id="racer-car-number"
                   value={formData.car_number || ''}
                   onChange={handleChange}
                   style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                 />
            </div>
            <div>
                 <label htmlFor="racer-car-weight" style={{ display: 'block', marginBottom: '5px' }}>Car Weight (oz)</label>
                 <input
                   type="number"
                   step="0.01"
                   name="car_weight"
               id="racer-car-weight"
                   value={formData.car_weight || ''}
                   onChange={handleChange}
                   placeholder="e.g. 5.0"
                   style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                 />
            </div>
        </div>

        <div style={{ marginBottom: '10px' }}>
             <label htmlFor="racer-car-name" style={{ display: 'block', marginBottom: '5px' }}>Car Name</label>
             <input
               type="text"
               name="car_name"
               id="racer-car-name"
               value={formData.car_name || ''}
               onChange={handleChange}
               placeholder="e.g. Blue Streak"
               style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
             />
        </div>

        <div style={{ marginBottom: '10px' }}>
             <label htmlFor="racer-den" style={{ display: 'block', marginBottom: '5px' }}>Den</label>
             <select
               name="den_id"
               id="racer-den"
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
            {/* `htmlFor` rather than a bare caption: the toggle is a styled
                checkbox, and without the association it has no accessible name
                at all — nothing to announce, and nothing to find it by. */}
            <label htmlFor="car-passed-inspection" style={{ display: 'block', marginBottom: '5px' }}>Passed Inspection / Checked In</label>
            <label className="toggle-switch">
                <input
                    id="car-passed-inspection"
                    type="checkbox"
                    name="car_passed_inspection"
                    checked={formData.car_passed_inspection}
                    onChange={handleChange}
                />
                <span className="slider"></span>
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
          {onSubmitAndContinue && (
            <button
              type="button"
              onClick={handleSubmitAndContinue}
              disabled={loading || !formData.first_name || !formData.last_name}
              className="secondary-btn"
              style={{ fontSize: '0.9rem', padding: '8px 16px' }}
            >
              Save and add another
            </button>
          )}
          <button type="submit" disabled={loading} className="primary-btn" style={{ fontSize: '0.9rem', padding: '8px 16px' }}>
            {loading ? 'Saving...' : (submitLabel || 'Save Racer')}
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
