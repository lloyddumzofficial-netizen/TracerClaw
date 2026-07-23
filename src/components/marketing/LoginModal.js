"use client";

import { memo, useState, useEffect } from "react";
import { X, ShieldCheck, Loader2, Mail } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { Turnstile } from '@marsidev/react-turnstile';

const LoginModal = memo(function LoginModal({ show, onClose, supabase }) {
  const [email, setEmail] = useState("");
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState(null);

  // Use the production key by default; localhost switches to Cloudflare's dummy testing key below.
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('0x4AAAAAAD26TJ8T3jCD57hp');

  useEffect(() => {
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      setTurnstileSiteKey('1x00000000000000000000AA'); // Cloudflare official dummy testing key
    }
  }, []);

  if (!show) return null;

  const handleGoogleLogin = async () => {
    if (!turnstileToken) {
      toast.error("Please complete the security check first.");
      return;
    }
    setIsLoadingGoogle(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { 
          redirectTo: `${window.location.origin}/api/auth/callback`,
          captchaToken: turnstileToken
        }
      });
      if (error) throw error;
    } catch (err) {
      toast.error("Google login failed. Please try again.");
      setIsLoadingGoogle(false);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!turnstileToken) {
      toast.error("Please complete the security check first.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }
    
    setIsLoadingEmail(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
          captchaToken: turnstileToken
        }
      });
      
      if (error) throw error;
      
      setEmailSent(true);
      toast.success("Magic link sent! Check your email.");
    } catch (err) {
      toast.error(err.message || "Failed to send login link.");
    } finally {
      setIsLoadingEmail(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: "blur(4px)", backgroundColor: "rgba(0,0,0,0.8)", zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'modalFadeIn 0.2s ease-out forwards' }}>

      <div 
        className="modal-content login-split-container" 
        style={{ 
          maxWidth: '1000px', 
          width: '100%', 
          padding: '0', 
          borderRadius: '0', 
          border: '1px solid #444', 
          background: '#262626', 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9)',
          position: 'relative',
          overflow: 'hidden'
        }}  
        onClick={(e) => e.stopPropagation()}
      >
        {/* Global Close Button (Top Right of entire modal) */}
        <button 
          onClick={onClose} 
          style={{ 
            position: 'absolute', 
            top: '16px',
            right: '16px', 
            background: 'rgba(0,0,0,0.5)', 
            border: 'none', 
            color: '#fff', 
            cursor: 'pointer', 
            padding: '6px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            transition: 'background 0.2s'
          }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(0,0,0,0.8)'}
          onMouseOut={e => e.currentTarget.style.background = 'rgba(0,0,0,0.5)'}
        >
          <X size={20} strokeWidth={2.5} />
        </button>

        {/* Left Side: Form */}
        <div className="login-form-side">
          {/* Header Area */}
          <div style={{ 
            background: '#262626', 
            padding: '48px 48px 0 48px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            position: 'relative'
          }}>
            <img src="/nav bar logo.png" alt="DesaynClaw Logo" style={{ height: '36px', width: 'auto' }} />
          </div>

          {/* Body Area */}
          <div style={{ padding: '24px 48px 48px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', maxWidth: '340px' }}>
            
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h2 style={{ color: '#fff', fontSize: '22px', fontWeight: '700', margin: '0 0 8px 0', letterSpacing: '-0.3px' }}>Secure Login</h2>
              <p style={{ color: '#aaa', fontSize: '14px', margin: '0' }}>Please verify to access your workspace.</p>
            </div>

            {emailSent ? (
              <div style={{ 
                background: '#111', 
                border: '1px solid #2a2a2a', 
                borderRadius: '4px', 
                padding: '24px', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                width: '100%',
                textAlign: 'center'
              }}>
                <ShieldCheck size={36} color="#4ade80" strokeWidth={1.5} style={{ marginBottom: '16px' }} />
                <div style={{ color: '#4ade80', fontWeight: '600', fontSize: '16px', marginBottom: '8px' }}>Check your email</div>
                <div style={{ color: '#aaa', fontSize: '14px', lineHeight: '1.5' }}>We sent a secure login link to <br/><strong style={{color: '#fff'}}>{email}</strong></div>
                <button 
                  onClick={() => setEmailSent(false)} 
                  style={{ background: 'none', border: 'none', color: '#888', fontSize: '13px', marginTop: '20px', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleEmailLogin} style={{ width: '100%' }}>
                
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', color: '#aaa', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Email Address
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} color="#666" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                      type="email" 
                      placeholder="e.g. user@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={isLoadingGoogle || isLoadingEmail}
                      style={{ 
                        width: '100%', 
                        background: '#1a1a1a', 
                        border: '1px solid #444',
                        borderRadius: '4px', 
                        padding: '14px 16px 14px 44px', 
                        color: '#fff', 
                        fontSize: '15px', 
                        outline: 'none', 
                        boxSizing: 'border-box',
                        transition: 'border-color 0.2s'
                      }} 
                      onFocus={e => e.target.style.borderColor = '#FFD700'} 
                      onBlur={e => e.target.style.borderColor = '#444'} 
                    />
                  </div>
                </div>

                {/* Main Button */}
                <button 
                  type="submit"
                  disabled={isLoadingGoogle || isLoadingEmail || !email.trim() || !turnstileToken}
                  style={{ 
                    width: '100%', 
                    background: '#FFD700', 
                    color: '#000', 
                    border: 'none', 
                    padding: '14px', 
                    borderRadius: '4px', 
                    fontSize: '14px', 
                    fontWeight: '700', 
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    cursor: (isLoadingGoogle || isLoadingEmail || !email.trim() || !turnstileToken) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'opacity 0.2s',
                    opacity: (isLoadingGoogle || isLoadingEmail || !email.trim() || !turnstileToken) ? 0.6 : 1,
                    marginBottom: '24px'
                  }}
                  onMouseOver={e => { if (!(isLoadingGoogle || isLoadingEmail || !email.trim() || !turnstileToken)) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseOut={e => { e.currentTarget.style.opacity = (isLoadingGoogle || isLoadingEmail || !email.trim() || !turnstileToken) ? 0.6 : 1; }}
                >
                  {isLoadingEmail ? <Loader2 size={16} className="animate-spin" /> : null}
                  {isLoadingEmail ? 'SENDING...' : 'SEND MAGIC LINK'}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginBottom: '24px' }}>
                  <div style={{ flex: 1, height: '1px', background: '#444' }}></div>
                  <span style={{ padding: '0 16px', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>OR</span>
                  <div style={{ flex: 1, height: '1px', background: '#444' }}></div>
                </div>

                {/* Google Button */}
                <button 
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoadingGoogle || isLoadingEmail || !turnstileToken}
                  style={{ 
                    width: '100%', 
                    background: 'transparent', 
                    color: '#d5d5d5', 
                    border: '1px solid #555', 
                    padding: '14px', 
                    borderRadius: '4px', 
                    fontSize: '14px', 
                    fontWeight: '600', 
                    cursor: (isLoadingGoogle || isLoadingEmail || !turnstileToken) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    transition: 'all 0.2s',
                    opacity: (isLoadingGoogle || isLoadingEmail || !turnstileToken) ? 0.6 : 1,
                  }}
                  onMouseOver={e => { 
                    if (!(isLoadingGoogle || isLoadingEmail || !turnstileToken)) {
                      e.currentTarget.style.background = '#333'; 
                      e.currentTarget.style.borderColor = '#777'; 
                    }
                  }}
                  onMouseOut={e => { 
                    e.currentTarget.style.background = 'transparent'; 
                    e.currentTarget.style.borderColor = '#555'; 
                  }}
                >
                  {isLoadingGoogle ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  )}
                  {isLoadingGoogle ? 'Connecting...' : 'Continue with Google'}
                </button>

                {/* Turnstile Widget */}
                <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: '20px', marginBottom: '8px', minHeight: '65px' }}>
                  <Turnstile 
                    siteKey={turnstileSiteKey} 
                    onSuccess={(token) => setTurnstileToken(token)}
                    onError={() => { toast.error("Security check failed."); setTurnstileToken(null); }}
                    onExpire={() => setTurnstileToken(null)}
                    options={{
                      theme: 'dark'
                    }}
                  />
                </div>

                {/* Terms and Privacy Footer */}
                <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '12px', color: '#aaa', lineHeight: '1.5' }}>
                  By proceeding, you agree to our <a href="/terms" style={{ color: '#4285F4', textDecoration: 'none', fontWeight: '500' }} onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'} onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}>Terms</a> and acknowledge<br/>
                  our <a href="/privacy" style={{ color: '#4285F4', textDecoration: 'none', fontWeight: '500' }} onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'} onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}>Privacy Policy</a>
                </div>
                
              </form>
            )}
            </div>
          </div>
        </div>
        
        {/* Right Side: Image */}
        <div className="login-image-side">
          <img 
            src="/loginmodal.png" 
            alt="DesaynClaw Workspace" 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
          />
        </div>

      </div>
    </div>
  );
});

export default LoginModal;
