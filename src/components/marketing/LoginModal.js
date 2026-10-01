"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X, ShieldCheck, Loader2, Mail } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { Turnstile } from '@marsidev/react-turnstile';
import { analytics } from "@/lib/analytics";

const LoginModal = memo(function LoginModal({ show, onClose, supabase }) {
  const [email, setEmail] = useState("");
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState(null);
  const turnstileRef = useRef(null);

  // Use the production key by default; localhost switches to Cloudflare's dummy testing key below.
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('0x4AAAAAAD26TJ8T3jCD57hp');

  useEffect(() => {
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      setTurnstileSiteKey('1x00000000000000000000AA'); // Cloudflare official dummy testing key
    }
  }, []);

  /**
   * A Turnstile token is SINGLE USE. Supabase forwards it to Cloudflare, which
   * rejects any replay with "captcha protection: request disallowed
   * (timeout-or-duplicate)". Without this, the token stayed in state after the
   * first submit and every retry replayed the spent token — so a user whose
   * first attempt failed (or who simply submitted twice) could not log in at
   * all until they hard-reloaded the page.
   *
   * Always discard the token and ask the widget for a fresh challenge after an
   * attempt, whether it succeeded or failed.
   */
  const consumeTurnstile = useCallback(() => {
    setTurnstileToken(null);
    try { turnstileRef.current?.reset(); } catch { /* widget already unmounted */ }
  }, []);

  // Reopening the modal must not carry a stale token across from last time.
  useEffect(() => {
    if (show) consumeTurnstile();
  }, [show, consumeTurnstile]);

  if (!show || typeof document === "undefined") return null;

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
      analytics.error(err, { area: "google_login" });
      toast.error("Google login failed. Please try again.");
      setIsLoadingGoogle(false);
      // The token was spent by the attempt above; get a fresh one before retry.
      consumeTurnstile();
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
      analytics.userLogin({ method: "magic_link_requested" });
      toast.success("Magic link sent! Check your email.");
    } catch (err) {
      analytics.error(err, { area: "email_login" });
      const isSpentToken = /timeout-or-duplicate|captcha/i.test(err.message || "");
      toast.error(
        isSpentToken
          ? "Security check expired. Please try again."
          : (err.message || "Failed to send login link.")
      );
    } finally {
      setIsLoadingEmail(false);
      // Always spend-and-refresh: the token is dead either way now.
      consumeTurnstile();
    }
  };

  return createPortal(
    <div className="login-modal-overlay" onClick={onClose}>
      <div
        className="login-modal-panel login-split-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="login-close-button" type="button" onClick={onClose} aria-label="Close login">
          <X size={18} strokeWidth={2} />
        </button>

        <div className="login-image-side">
          <video
            className="login-banner-video"
            src="/login-page.mp4"
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            controlsList="nodownload nofullscreen noremoteplayback"
            preload="metadata"
            tabIndex={-1}
            aria-label="DesaynClaw workspace preview"
          />
          <div className="login-visual-shade" aria-hidden="true" />
          <div className="login-visual-copy">
            <span className="login-visual-kicker">DesaynClaw workspace</span>
            <p>From rough artwork to clean, production-ready files.</p>
            <div className="login-visual-proof">
              <ShieldCheck size={15} />
              <span>Private by default · Auto-deleted after 3 days</span>
            </div>
          </div>
        </div>

        <div className="login-form-side">
          <div className="login-form-header">
            <Image src="/nav bar logo.png" alt="DesaynClaw" width={188} height={40} priority />
          </div>

          <div className="login-form-body">
            <div className="login-auth-shell">
              <div className="login-auth-heading">
                <span className="login-auth-kicker"><ShieldCheck size={13} /> Secure workspace</span>
                <h2 id="login-modal-title">Welcome back.</h2>
                <p>Sign in to continue your production workflow.</p>
              </div>

              {emailSent ? (
                <div className="login-success-panel">
                  <span className="login-success-icon"><ShieldCheck size={24} strokeWidth={1.8} /></span>
                  <strong>Check your email</strong>
                  <p>We sent a secure login link to<br /><b>{email}</b></p>
                  <button type="button" onClick={() => setEmailSent(false)}>Use a different email</button>
                </div>
              ) : (
                <form className="login-auth-form" onSubmit={handleEmailLogin}>
                  <div className="login-field-group">
                    <label htmlFor="login-email">Email address</label>
                    <div className="login-field-control">
                      <Mail size={16} aria-hidden="true" />
                      <input
                        id="login-email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        disabled={isLoadingGoogle || isLoadingEmail}
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <button
                    className="login-primary-action"
                    type="submit"
                    disabled={isLoadingGoogle || isLoadingEmail || !email.trim() || !turnstileToken}
                  >
                    {isLoadingEmail && <Loader2 size={16} className="animate-spin" />}
                    {isLoadingEmail ? "Sending secure link..." : "Send magic link"}
                  </button>

                  <div className="login-divider"><span>or continue with</span></div>

                  <button
                    className="login-google-action"
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoadingGoogle || isLoadingEmail || !turnstileToken}
                  >
                    {isLoadingGoogle ? <Loader2 size={18} className="animate-spin" /> : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                    )}
                    {isLoadingGoogle ? "Connecting..." : "Continue with Google"}
                  </button>

                  <div className="login-turnstile-shell">
                    <Turnstile
                      ref={turnstileRef}
                      siteKey={turnstileSiteKey}
                      onSuccess={(token) => setTurnstileToken(token)}
                      onError={() => { toast.error("Security check failed."); setTurnstileToken(null); }}
                      onExpire={() => { setTurnstileToken(null); try { turnstileRef.current?.reset(); } catch {} }}
                      options={{ theme: "dark" }}
                    />
                  </div>

                  <p className="login-legal">
                    By continuing, you agree to our <a href="/terms">Terms</a> and acknowledge our <a href="/privacy">Privacy Policy</a>.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

export default LoginModal;
