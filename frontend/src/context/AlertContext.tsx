import React, { createContext, useContext, useState, ReactNode } from 'react';
import Modal from '../components/Modal';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  action?: ToastAction;
}

interface AlertContextType {
  showAlert: (message: string, title?: string) => void;
  showConfirm: (message: string, title?: string, confirmLabel?: string, confirmVariant?: 'primary' | 'danger') => Promise<boolean>;
  showToast: (message: string, type?: 'success' | 'error' | 'info', action?: ToastAction) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('Alert');
  const [isConfirm, setIsConfirm] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState('Confirm');
  const [confirmVariant, setConfirmVariant] = useState<'primary' | 'danger'>('primary');
  const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [nextToastId, setNextToastId] = useState(1);

  const showAlert = (msg: string, t: string = 'Alert') => {
    setMessage(msg);
    setTitle(t);
    setIsConfirm(false);
    setIsOpen(true);
  };

  const showConfirm = (msg: string, t: string = 'Confirm', label: string = 'Confirm', variant: 'primary' | 'danger' = 'primary'): Promise<boolean> => {
    setMessage(msg);
    setTitle(t);
    setConfirmLabel(label);
    setConfirmVariant(variant);
    setIsConfirm(true);
    setIsOpen(true);
    return new Promise((resolve) => {
        setResolvePromise(() => resolve);
    });
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info', action?: ToastAction) => {
    const id = nextToastId;
    setNextToastId(id + 1);
    
    const toast: Toast = { id, message: msg, type, action };
    setToasts(prev => [...prev, toast]);

    // Auto-dismiss after 5 seconds if no action
    if (!action) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);
    } else {
      // With action, dismiss after 10 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 10000);
    }
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleAction = (result: boolean) => {
    setIsOpen(false);
    if (resolvePromise) {
        resolvePromise(result);
        setResolvePromise(null);
    }
  };

  const closeAlert = () => {
      if (isConfirm && resolvePromise) {
          handleAction(false);
      } else {
          setIsOpen(false);
      }
  };

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm, showToast }}>
      {children}
      <Modal isOpen={isOpen} onClose={closeAlert} title={title}>
        <div style={{ marginBottom: '1.5rem', whiteSpace: 'pre-wrap' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          {isConfirm && (
              <button 
                onClick={() => handleAction(false)} 
                className="secondary-btn"
                style={{ backgroundColor: '#e0e0e0', color: '#333' }}
              >
                  Cancel
              </button>
          )}
          <button 
            onClick={() => handleAction(true)} 
            className="primary-btn"
            style={confirmVariant === 'danger' ? { backgroundColor: '#d32f2f', color: 'white' } : {}}
          >
            {isConfirm ? confirmLabel : 'OK'}
          </button>
        </div>
      </Modal>

      {/* Toast Container */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minWidth: '300px',
        maxWidth: '500px',
      }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{
              background: toast.type === 'success' ? '#4caf50' : toast.type === 'error' ? '#f44336' : '#2196f3',
              color: 'white',
              padding: '12px 16px',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              animation: 'slideUp 0.3s ease-out',
            }}
          >
            <span style={{ flex: 1 }}>{toast.message}</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action!.onClick();
                    dismissToast(toast.id);
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: '1px solid rgba(255,255,255,0.5)',
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 'bold',
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                onClick={() => dismissToast(toast.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  padding: '0 4px',
                  opacity: 0.7,
                }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </AlertContext.Provider>
  );
};
