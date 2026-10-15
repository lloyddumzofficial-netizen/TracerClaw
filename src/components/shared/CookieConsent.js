"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Cookie, X } from "lucide-react";
import "./consent-surfaces.css";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => setVisible(false), 360);
  };

  const accept = () => {
    localStorage.setItem("cookie_consent", "accepted");
    window.dispatchEvent(new CustomEvent("desaynclaw:cookie-consent", { detail: "accepted" }));
    dismiss();
  };

  const decline = () => {
    localStorage.setItem("cookie_consent", "declined");
    window.dispatchEvent(new CustomEvent("desaynclaw:cookie-consent", { detail: "declined" }));
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="cookie-consent-shell">
      <aside
        className={`cookie-consent${leaving ? " is-leaving" : ""}`}
        aria-label="Cookie preferences"
      >
        <div className="cookie-consent-icon" aria-hidden="true">
          <Cookie size={17} strokeWidth={1.8} />
        </div>

        <div className="cookie-consent-copy">
          <strong>Your privacy choices</strong>
          <p>
            We use essential cookies and local storage to keep your session secure and remember your preferences.
            {" "}
            <a href="/privacy">
              Privacy Policy <ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
            </a>
          </p>
        </div>

        <div className="cookie-consent-actions">
          <button type="button" className="cookie-consent-decline" onClick={decline}>
            Decline
          </button>
          <button type="button" className="cookie-consent-accept" onClick={accept}>
            Accept cookies
          </button>
          <button
            type="button"
            className="cookie-consent-dismiss"
            onClick={dismiss}
            aria-label="Dismiss cookie banner"
          >
            <X size={17} strokeWidth={1.8} />
          </button>
        </div>
      </aside>
    </div>
  );
}
