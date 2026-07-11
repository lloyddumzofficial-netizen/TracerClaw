import React, { useState, useEffect } from 'react';

export default function AIDisclaimerModal() {
  const [show, setShow] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10);

  useEffect(() => {
    const hasSeen = sessionStorage.getItem('ai_disclaimer_seen');
    if (!hasSeen) {
      setShow(true);
    }
  }, []);

  useEffect(() => {
    if (!show || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [show, timeLeft]);

  const handleClose = () => {
    if (timeLeft > 0) return;
    sessionStorage.setItem('ai_disclaimer_seen', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(8px)',
      padding: '20px'
    }}>
      <div style={{
        background: '#111', border: '1px solid #333', borderRadius: '16px',
        maxWidth: '540px', width: '100%', padding: '48px 40px',
        textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <h2 style={{
          fontSize: '28px', fontWeight: '300', margin: '0 0 24px 0', color: '#fff',
          letterSpacing: '-0.5px'
        }}>
          Data Privacy & <span style={{ color: '#FFD700', fontWeight: '400' }}>Protection</span>
        </h2>
        
        {/* Highlighted Quote */}
        <div style={{
          background: 'rgba(255, 215, 0, 0.05)',
          borderLeft: '4px solid #FFD700',
          padding: '24px',
          marginBottom: '40px',
          borderRadius: '0 12px 12px 0'
        }}>
          <h3 style={{ 
            color: '#fff', 
            fontSize: '22px', 
            fontWeight: '800', 
            margin: '0', 
            lineHeight: '1.4',
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}>
            We respect your privacy.<br/>
            <span style={{ color: '#FFD700' }}>You own your data.</span>
          </h3>
        </div>
        
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '48px' }}>
          <div>
            <div style={{ color: '#fff', fontSize: '15px', fontWeight: '500', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>1. No Data Harvesting</div>
            <div style={{ color: '#aaa', fontSize: '14px', fontWeight: '300', lineHeight: '1.7' }}>
              We do not permanently store, sell, or share your uploaded images. Furthermore, your personal files are never used to train our AI models.
            </div>
          </div>
          <div style={{ height: '1px', background: '#222', width: '100%' }}></div>
          <div>
            <div style={{ color: '#fff', fontSize: '15px', fontWeight: '500', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>2. Temporary Processing</div>
            <div style={{ color: '#aaa', fontSize: '14px', fontWeight: '300', lineHeight: '1.7' }}>
              Your files are kept in our secure cloud solely for the duration of the conversion process. Once completed, they are automatically purged from our servers.
            </div>
          </div>
          <div style={{ height: '1px', background: '#222', width: '100%' }}></div>
          <div>
            <div style={{ color: '#fff', fontSize: '15px', fontWeight: '500', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>3. 100% Copyright Ownership</div>
            <div style={{ color: '#aaa', fontSize: '14px', fontWeight: '300', lineHeight: '1.7' }}>
              You retain all intellectual property and copyright to your original uploads and the resulting vectors. We claim no ownership over your work.
            </div>
          </div>
        </div>

        <button 
          onClick={handleClose}
          disabled={timeLeft > 0}
          style={{
            background: timeLeft > 0 ? '#222' : '#FFD700',
            color: timeLeft > 0 ? '#666' : '#000',
            border: timeLeft > 0 ? '1px solid #333' : 'none',
            padding: '16px 32px',
            borderRadius: '50px',
            fontSize: '14px',
            fontWeight: '600',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            cursor: timeLeft > 0 ? 'not-allowed' : 'pointer',
            width: '100%',
            transition: 'all 0.3s ease',
            opacity: timeLeft > 0 ? 0.7 : 1
          }}
          onMouseOver={(e) => { if(timeLeft <= 0) e.currentTarget.style.transform = 'translateY(-2px)' }}
          onMouseOut={(e) => { if(timeLeft <= 0) e.currentTarget.style.transform = 'translateY(0)' }}
        >
          {timeLeft > 0 ? `Please read... (${timeLeft}s)` : 'I Understand & Agree'}
        </button>
      </div>
    </div>
  );
}
