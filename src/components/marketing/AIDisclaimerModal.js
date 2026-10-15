import { useEffect, useState } from "react";
import { ArrowRight, Clock3, LockKeyhole, ShieldCheck } from "lucide-react";
import "../shared/consent-surfaces.css";

const privacyPoints = [
  {
    icon: LockKeyhole,
    label: "Private by default",
    text: "Your uploads are processed only to provide the tools you request. We do not sell your files or use them to train AI models.",
  },
  {
    icon: Clock3,
    label: "Short-term retention",
    text: "Project files remain available for up to three days, then are automatically removed from cloud storage.",
  },
  {
    icon: ShieldCheck,
    label: "Your work stays yours",
    text: "You retain the intellectual property and copyright to your original uploads and generated outputs.",
  },
];

export default function AIDisclaimerModal() {
  const [show, setShow] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const hasSeen = localStorage.getItem("ai_disclaimer_seen");
    if (!hasSeen) setShow(true);
  }, []);

  useEffect(() => {
    if (!show || timeLeft <= 0) return;
    const timer = setInterval(() => setTimeLeft((previous) => previous - 1), 1000);
    return () => clearInterval(timer);
  }, [show, timeLeft]);

  const handleClose = () => {
    if (timeLeft > 0) return;
    localStorage.setItem("ai_disclaimer_seen", "true");
    window.dispatchEvent(new Event("desaynclaw:data-privacy-accepted"));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="privacy-consent-overlay">
      <section
        className="privacy-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-consent-title"
        aria-describedby="privacy-consent-description"
      >
        <header className="privacy-consent-header">
          <div className="privacy-consent-mark" aria-hidden="true">
            <ShieldCheck size={20} strokeWidth={1.8} />
          </div>
          <div>
            <p className="privacy-consent-kicker">Before you continue</p>
            <h2 id="privacy-consent-title">Your work stays yours.</h2>
            <p id="privacy-consent-description">
              A clear summary of how DesaynClaw handles your files and creative work.
            </p>
          </div>
        </header>

        <div className="privacy-consent-points">
          {privacyPoints.map(({ icon: Icon, label, text }, index) => (
            <article className="privacy-consent-point" key={label}>
              <div className="privacy-consent-point-icon" aria-hidden="true">
                <Icon size={17} strokeWidth={1.8} />
              </div>
              <div>
                <div className="privacy-consent-point-heading">
                  <span>0{index + 1}</span>
                  <h3>{label}</h3>
                </div>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="privacy-consent-footer">
          <p>
            Full details are available in our <a href="/privacy">Privacy Policy</a>.
          </p>
          <button
            type="button"
            className="privacy-consent-accept"
            onClick={handleClose}
            disabled={timeLeft > 0}
          >
            <span>{timeLeft > 0 ? `Please read (${timeLeft}s)` : "I understand — continue"}</span>
            {timeLeft <= 0 && <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
      </section>
    </div>
  );
}
