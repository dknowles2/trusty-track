import React, { createContext, useContext, useState, ReactNode } from 'react';
import Modal from '../components/Modal';

interface AlertContextType {
  showAlert: (message: string, title?: string) => void;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
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
  const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

  const showAlert = (msg: string, t: string = 'Alert') => {
    setMessage(msg);
    setTitle(t);
    setIsConfirm(false);
    setIsOpen(true);
  };

  const showConfirm = (msg: string, t: string = 'Confirm'): Promise<boolean> => {
    setMessage(msg);
    setTitle(t);
    setIsConfirm(true);
    setIsOpen(true);
    return new Promise((resolve) => {
        setResolvePromise(() => resolve);
    });
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
    <AlertContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      <Modal isOpen={isOpen} onClose={closeAlert} title={title}>
        <div style={{ marginBottom: '1.5rem', whiteSpace: 'pre-wrap' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          {isConfirm && (
              <button onClick={() => handleAction(false)} className="secondary-btn">
                  Cancel
              </button>
          )}
          <button onClick={() => handleAction(true)} className="primary-btn">
            {isConfirm ? 'Confirm' : 'OK'}
          </button>
        </div>
      </Modal>
    </AlertContext.Provider>
  );
};
