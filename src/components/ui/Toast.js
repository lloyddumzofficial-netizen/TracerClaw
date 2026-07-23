"use client";
import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Info } from "lucide-react";

let toastEmitter = null;

export const toast = {
  success: (message) => { if (toastEmitter) toastEmitter(message, "success"); },
  error: (message) => { if (toastEmitter) toastEmitter(message, "error"); },
  info: (message) => { if (toastEmitter) toastEmitter(message, "info"); },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    toastEmitter = (message, type) => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    };
    return () => { toastEmitter = null; };
  }, []);

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      pointerEvents: 'none'
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: '#1a1a1a',
          border: '1px solid #444',
          padding: '14px 20px',
          color: '#fff',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          animation: 'toastSlideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          pointerEvents: 'auto',
          minWidth: '300px'
        }}>
          {t.type === 'success' && <CheckCircle size={18} color="#4ade80" />}
          {t.type === 'error' && <XCircle size={18} color="#f87171" />}
          {t.type === 'info' && <Info size={18} color="#60a5fa" />}
          
          <span style={{ fontSize: '14px', fontWeight: '500' }}>{t.message}</span>
        </div>
      ))}

      <style jsx global>{`
        @keyframes toastSlideIn {
          0% { transform: translateX(120%); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
