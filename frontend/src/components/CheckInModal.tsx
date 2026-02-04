import { useState } from 'react';
import { RacerData } from './RacerForm';
import { apiClient } from '../api/client';
import CameraCapture from './CameraCapture';
import { useAlert } from '../context/AlertContext';

interface Racer extends RacerData {
    id: number;
    car_weight?: number;
    racer_image_url?: string;
    car_image_url?: string;
}

interface CheckInModalProps {
    racer: Racer;
    onClose: () => void;
    onSave: () => void;
}

export default function CheckInModal({ racer, onClose, onSave }: CheckInModalProps) {
    const { showAlert } = useAlert();
    const [passedInspection, setPassedInspection] = useState(racer.car_passed_inspection || false);
    const [weight, setWeight] = useState<string>(racer.car_weight?.toString() || '');
    // Local URL state for immediate feedback
    const [racerImageUrl, setRacerImageUrl] = useState<string | undefined>(racer.racer_image_url);
    const [carImageUrl, setCarImageUrl] = useState<string | undefined>(racer.car_image_url);
    
    const [loading, setLoading] = useState(false);
    const [showCamera, setShowCamera] = useState<'none' | 'racer' | 'car'>('none');

    const uploadFile = async (file: File, type: 'racer' | 'car') => {
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('http://127.0.0.1:8000/upload/', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                const newUrl = result.url;
                
                // Update local state for immediate feedback
                if (type === 'racer') {
                    setRacerImageUrl(newUrl);
                } else {
                    setCarImageUrl(newUrl);
                }

                // Auto-save to backend
                const updateData = {
                    ...racer,
                    car_passed_inspection: passedInspection,
                    car_weight: weight ? parseFloat(weight) : null,
                    // Use new URL for the type being updated, current state (or prop) for the other
                    racer_image_url: type === 'racer' ? newUrl : racerImageUrl,
                    car_image_url: type === 'car' ? newUrl : carImageUrl
                };
                
                await apiClient.put(`/racers/${racer.id}`, updateData);
                // Trigger parent refresh if needed? onSave currently just fetches racers.
                // We should probably call onSave here to refresh parent state, 
                // BUT onSave usually closes the modal in other contexts? 
                // No, onSave in RaceDetails just calls fetchRacers.
                onSave(); 

            } else {
                console.error("Upload failed");
                showAlert("Failed to upload image", "Error");
            }
        } catch (error) {
            console.error("Upload error", error);
            showAlert("Error uploading image", "Error");
        }
    };
    
    const handleCapture = (file: File, type: 'racer' | 'car') => {
        uploadFile(file, type);
        setShowCamera('none');
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'racer' | 'car') => {
        if (e.target.files && e.target.files[0]) {
             uploadFile(e.target.files[0], type);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Update Racer
            const updateData = {
                ...racer,
                car_passed_inspection: passedInspection,
                car_weight: weight ? parseFloat(weight) : null,
                racer_image_url: racerImageUrl,
                car_image_url: carImageUrl
            };

            await apiClient.put(`/racers/${racer.id}`, updateData);
            onSave();
            onClose();

        } catch (e) {
            console.error("Check-in failed", e);
            showAlert("Failed to save check-in data.", "Error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: '20px' }}>
            <h3 style={{ marginTop: 0 }}>Check In: {racer.first_name} {racer.last_name}</h3>
            
            <form onSubmit={handleSave}>
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Passed Inspection?</label>
                    <label className="toggle-switch">
                        <input 
                            type="checkbox" 
                            checked={passedInspection} 
                            onChange={e => setPassedInspection(e.target.checked)} 
                        />
                         <span className="slider"></span>
                    </label>
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Car Weight (oz)</label>
                    <input 
                        type="number" 
                        step="0.01" 
                        value={weight} 
                        onChange={e => setWeight(e.target.value)}
                        placeholder="e.g. 5.0"
                        style={{ width: '100%', padding: '8px' }}
                    />
                </div>

                <div style={{ marginBottom: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Racer Photo</label>
                        {racerImageUrl && (
                            <img src={racerImageUrl} alt="Racer" style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block', marginBottom: '5px', borderRadius: '4px', backgroundColor: '#eee' }} />
                        )}
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <input 
                                type="file" 
                                accept="image/*" 
                                style={{ width: '0.1px', height: '0.1px', opacity: 0, overflow: 'hidden', position: 'absolute', zIndex: -1 }}
                                id="checkin-racer-file"
                                onChange={(e) => handleFileSelect(e, 'racer')} 
                            />
                            <label htmlFor="checkin-racer-file" className="secondary-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '5px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                                Upload
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
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Car Photo</label>
                        {carImageUrl && (
                             <img src={carImageUrl} alt="Car" style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block', marginBottom: '5px', borderRadius: '4px', backgroundColor: '#eee' }} />
                        )}
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <input 
                                type="file" 
                                accept="image/*" 
                                style={{ width: '0.1px', height: '0.1px', opacity: 0, overflow: 'hidden', position: 'absolute', zIndex: -1 }}
                                id="checkin-car-file"
                                onChange={(e) => handleFileSelect(e, 'car')} 
                            />
                             <label htmlFor="checkin-car-file" className="secondary-btn" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', padding: '5px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                                Upload
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

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <button type="button" onClick={onClose} disabled={loading} className="secondary-btn">Cancel</button>
                    <button type="submit" disabled={loading} className="primary-btn">Save Check-in</button>
                </div>
            </form>
            
            {showCamera !== 'none' && (
                <CameraCapture 
                    onClose={() => setShowCamera('none')}
                    onCapture={(file) => handleCapture(file, showCamera as 'racer' | 'car')}
                />
            )}
        </div>
    );
}
