import { useState, useEffect } from 'react';

export default function AIDisclaimerModal() {
  const [show, setShow] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const hasSeen = localStorage.getItem('ai_disclaimer_seen');
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
    localStorage.setItem('ai_disclaimer_seen', 'true');
    window.dispatchEvent(new Event('desaynclaw:data-privacy-accepted'));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.78)', backdropFilter: 'blur(10px)',
      padding: '20px'
    }}>
      <div style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008)), #111',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: '6px',
        maxWidth: '540px', width: '100%', padding: '30px 24px',
        textAlign: 'center',
        boxShadow: '0 28px 90px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255,255,255,0.04)',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <h2 style={{
          fontSize: '27px', fontWeight: '500', margin: '0 0 22px 0', color: '#f4f4f4',
          letterSpacing: '-0.03em'
        }}>
          Data Privacy & <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: '400' }}>Protection</span>
        </h2>
        
        {/* Highlighted Quote */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.035)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderLeft: '2px solid rgba(255, 215, 0, 0.78)',
          padding: '20px 22px',
          marginBottom: '34px',
          borderRadius: '4px'
        }}>
          <h3 style={{ 
            color: '#fff', 
            fontSize: '20px', 
            fontWeight: '600', 
            margin: '0', 
            lineHeight: '1.4',
            letterSpacing: '0',
            textTransform: 'uppercase'
          }}>
            We respect your privacy.<br/>
            <span style={{ color: 'rgba(255,255,255,0.82)' }}>You own your data.</span>
          </h3>
        </div>
        
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '22px', marginBottom: '34px' }}>
          <div>
            <div style={{ color: '#f5f5f5', fontSize: '14px', fontWeight: '600', marginBottom: '7px', letterSpacing: '0', textTransform: 'uppercase' }}>1. No Data Harvesting</div>
            <div style={{ color: 'rgba(255,255,255,0.58)', fontSize: '14px', fontWeight: '400', lineHeight: '1.65' }}>
              We do not permanently store, sell, or share your uploaded images. Furthermore, your personal files are never used to train our AI models.
            </div>
          </div>
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.075)', width: '100%' }}></div>
          <div>
            <div style={{ color: '#f5f5f5', fontSize: '14px', fontWeight: '600', marginBottom: '7px', letterSpacing: '0', textTransform: 'uppercase' }}>2. Temporary Processing</div>
            <div style={{ color: 'rgba(255,255,255,0.58)', fontSize: '14px', fontWeight: '400', lineHeight: '1.65' }}>
              Your files are kept in our secure cloud solely for the duration of the conversion process. Once completed, they are automatically purged from our servers.
            </div>
          </div>
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.075)', width: '100%' }}></div>
          <div>
            <div style={{ color: '#f5f5f5', fontSize: '14px', fontWeight: '600', marginBottom: '7px', letterSpacing: '0', textTransform: 'uppercase' }}>3. 100% Copyright Ownership</div>
            <div style={{ color: 'rgba(255,255,255,0.58)', fontSize: '14px', fontWeight: '400', lineHeight: '1.65' }}>
              You retain all intellectual property and copyright to your original uploads and the resulting vectors. We claim no ownership over your work.
            </div>
          </div>
        </div>

        <button 
          onClick={(e) => {
            e.preventDefault();
            handleClose();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleClose();
          }}
          disabled={timeLeft > 0}
          style={{
            background: timeLeft > 0 ? '#171717' : '#f4f4f4',
            color: timeLeft > 0 ? '#666' : '#050505',
            border: timeLeft > 0 ? '1px solid #2b2b2b' : '1px solid #f4f4f4',
            padding: '14px 28px',
            borderRadius: '5px',
            fontSize: '13px',
            fontWeight: '600',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: timeLeft > 0 ? 'not-allowed' : 'pointer',
            width: '100%',
            transition: 'all 0.3s ease',
            opacity: timeLeft > 0 ? 0.7 : 1,
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          {timeLeft > 0 ? `Please read... (${timeLeft}s)` : 'I Understand & Agree'}
        </button>
      </div>
    </div>
  );
}
