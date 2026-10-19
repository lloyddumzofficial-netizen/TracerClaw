"use client";

// ─── React & Routing ──────────────────────────────────────────────────────────
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import laptopPreview from "../../public/LAPTOP.jpg";

// ─── Data & Auth ──────────────────────────────────────────────────────────────
import { createClient } from "@/utils/supabase/client";
import { toast } from "@/components/ui/Toast";
import { compressImageClientSide } from "@/utils/imageUtils";
import { analytics } from "@/lib/analytics";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import { safeJson } from "@/lib/safeJson";

import { ImageIcon, Monitor, LogIn, FilePlus, User, Trash2, LogOut, CheckCircle2, X, Scan, Scissors, Play, Search, Layers, Zap, ArrowUpRight, ChevronLeft, ChevronRight, Gift } from "lucide-react";

// ─── Styles ───────────────────────────────────────────────────────────────────
import "./home.css";

// ─── Components ───────────────────────────────────────────────────────────────
import LoginModal from "@/components/marketing/LoginModal";
import NewProjectModal from "@/components/marketing/NewProjectModal";
import OnboardingModal from "@/components/marketing/OnboardingModal";
import RecentProjects from "@/components/marketing/RecentProjects";
import EduSection from "@/components/marketing/EduSection";
import BeforeAfterSlider from "@/components/marketing/BeforeAfterSlider";
import FAQSection from "@/components/marketing/FAQSection";
import LogoLoader from "@/components/ui/LogoLoader";
import AIDisclaimerModal from "@/components/marketing/AIDisclaimerModal";
import TestimonialSection from "@/components/marketing/TestimonialSection";
import GuestHomepageHero, { GuestHomepageConversionSections, GuestHomepageSampleSection } from "@/components/marketing/GuestHomepageHero";
import HomeTrustMarquee from "@/components/marketing/HomeTrustMarquee";
import HomepageTutorialSection from "@/components/marketing/HomepageTutorialSection";
import ReferralModal from "@/components/marketing/ReferralModal";
import ReferralPromptController from "@/components/marketing/ReferralPromptController";
import ClawRewardNotice from "@/components/shared/ClawRewardNotice";
import { markReferralPromptSeen } from "@/lib/referralPrompt";

const TopUpModal = dynamic(() => import("@/components/ui/TopUpModal"), { ssr: false });
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
const PUBLIC_STATS_CACHE_KEY = "desaynclaw-public-stats-v2";
const DRIVE_ANNOUNCEMENT_DISMISS_KEY = "desaynclaw-drive-announcement-v1";

async function uploadFileToPresignedUrl(uploadUrl, file) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (response.ok) return response;
      if (![408, 429].includes(response.status) && response.status < 500) return response;
      lastError = new Error(`Storage upload failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 700));
  }

  throw lastError || new Error("Failed to upload image to storage");
}

async function uploadFileThroughServer({ token, file, purpose }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", purpose);

  const response = await fetch("/api/upload-direct", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
  });
  const data = await safeJson(response, "Fallback upload failed");

  if (!response.ok || !data.publicUrl) {
    throw new Error(data.error || "Fallback upload failed");
  }

  return data.publicUrl;
}

async function uploadImageToStorage({ token, file, purpose }) {
  const urlRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      purpose,
    })
  });

  const urlData = await safeJson(urlRes, "Failed to get upload URL");
  if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");

  try {
    const putRes = await uploadFileToPresignedUrl(urlData.uploadUrl, file);
    if (!putRes.ok) throw new Error("Failed to upload image to storage");
    return urlData.publicUrl;
  } catch (error) {
    console.warn("Direct R2 upload failed, retrying through server:", error);
    return uploadFileThroughServer({ token, file, purpose });
  }
}

function HomepageWorkflowPreview({ onStart }) {
  return (
    <section className="workflow-preview-section" aria-label="DesaynClaw output preview">
      <div className="workflow-preview-copy">
        <h2>
          Clean production files
          <em>from rough artwork.</em>
        </h2>
        <p>
          See the full handoff after upload: cropped artwork, vector controls,
          transparent assets, and export-ready files built for real print shop work.
        </p>
        <button className="workflow-preview-cta" type="button" onClick={onStart}>
          Start designing
          <span><ArrowUpRight size={16} aria-hidden="true" /></span>
        </button>
      </div>

      <div className="workflow-mockup" aria-hidden="true">
        <Image
          className="workflow-standalone-image"
          src={laptopPreview}
          alt=""
          sizes="(max-width: 980px) 100vw, 720px"
          loading="lazy"
        />
      </div>
    </section>
  );
}

function DesktopToolsShelf({ onExtract, onUpscale, onBgRemover, onMockupStudio }) {
  const trackRef = useRef(null);
  const tools = [
    {
      title: "Garment Extract",
      description: "Turn jersey and garment mockups into clean, editable production artwork.",
      action: "Start extracting",
      image: "/samples/Reference.webp",
      imageClassName: "is-cover",
      onClick: onExtract,
    },
    {
      title: "Image Upscaler",
      description: "Recover cleaner edges and usable resolution while preserving the original.",
      action: "Open upscaler",
      comparison: {
        leftImage: "/samples/upscale-hq.webp",
        rightImage: "/samples/upscale-original.png",
        className: "is-upscale-comparison",
      },
      onClick: onUpscale,
    },
    {
      title: "Background Remover",
      description: "Isolate subjects with transparent edges ready for design and production.",
      action: "Remove background",
      comparison: {
        leftImage: "/samples/DesaynClaw_f3fe3b3f-bf6f-4182-9cc8-79a5a8204c6c_Transparent.webp",
        rightImage: "/samples/f3fe3b3f-bf6f-4182-9cc8-79a5a8204c6c.webp",
        className: "is-cutout-comparison",
      },
      onClick: onBgRemover,
    },
    {
      title: "Mockup Studio",
      description: "Build polished garment previews from production panels and artwork.",
      action: "Open studio",
      image: "/MOCKUP_STUDIO_thumbnail.jpg",
      imageClassName: "is-cover is-mockup-photo",
      onClick: onMockupStudio,
    },
  ];

  const scrollTools = (direction) => {
    trackRef.current?.scrollBy({
      left: direction * Math.min(trackRef.current.clientWidth * 0.82, 440),
      behavior: "smooth",
    });
  };

  return (
    <section id="workspace-tools" className="desktop-tools-shelf" aria-labelledby="desktop-tools-title">
      <header className="desktop-tools-heading">
        <div className="desktop-tools-heading-copy">
          <span className="desktop-tools-kicker">DesaynClaw workspaces</span>
          <h2 id="desktop-tools-title">Tools</h2>
        </div>
        <div className="desktop-tools-controls" aria-label="Browse tools">
          <button type="button" onClick={() => scrollTools(-1)} aria-label="Previous tools">
            <ChevronLeft size={19} strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => scrollTools(1)} aria-label="Next tools">
            <ChevronRight size={19} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="desktop-tools-track" ref={trackRef} role="list">
        {tools.map((tool) => (
          <article className="desktop-tool-card" key={tool.title} role="listitem">
            {tool.comparison ? (
              <div className={`desktop-tool-comparison ${tool.comparison.className}`} aria-hidden="true">
                <div className="desktop-tool-comparison-right">
                  <Image
                    src={tool.comparison.rightImage}
                    alt=""
                    fill
                    sizes="(max-width: 700px) 82vw, (max-width: 1100px) 44vw, 360px"
                    loading="lazy"
                  />
                </div>
                <div className="desktop-tool-comparison-left">
                  <div className="desktop-tool-comparison-left-image">
                    <Image
                      src={tool.comparison.leftImage}
                      alt=""
                      fill
                      sizes="(max-width: 700px) 82vw, (max-width: 1100px) 44vw, 360px"
                      loading="lazy"
                    />
                  </div>
                </div>
                <span className="desktop-tool-comparison-line">
                  <span>Ⅱ</span>
                </span>
              </div>
            ) : (
              <div className={`desktop-tool-visual ${tool.imageClassName}`}>
                <Image
                  src={tool.image}
                  alt=""
                  fill
                  sizes="(max-width: 700px) 82vw, (max-width: 1100px) 44vw, 360px"
                  loading="lazy"
                />
              </div>
            )}
            <div className="desktop-tool-card-shade" />
            <div className="desktop-tool-card-copy">
              <h3>{tool.title}</h3>
              <p>{tool.description}</p>
              <button type="button" onClick={tool.onClick}>
                {tool.action}
                <ArrowUpRight size={15} strokeWidth={1.8} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      icon: Search,
      title: "Upload your source",
      body: "Start with a logo, jersey mockup, product photo, or raster artwork you need cleaned for production.",
      bullets: [
        "PNG, JPG, JPEG, and WebP support",
        "Desktop upload or phone scan",
        "Optional AI noise cleanup",
      ],
    },
    {
      icon: Layers,
      title: "Choose the right tool",
      body: "Pick the workflow that fits the job: vector tracing, background removal, image upscale, or crop-to-extract.",
      bullets: [
        "Flat extract for apparel mockups",
        "Precision SVG for logos and marks",
        "4K upscale and transparent cutouts",
      ],
    },
    {
      icon: Zap,
      title: "Export production files",
      body: "Download clean output files ready for editing, printing, client delivery, or handoff to your production team.",
      bullets: [
        "Editable SVG and high-res PNG",
        "ZIP package for complete delivery",
        "Auto-deletes after 3 days",
      ],
    },
  ];

  return (
    <section id="process" className="how-it-works-section" aria-label="How DesaynClaw works">
      <div className="how-it-works-heading">
        <h2>How it works</h2>
        <p>Turn messy raster artwork into clean, scalable production files in a focused three-step workflow.</p>
      </div>

      <div className="how-step-line" aria-hidden="true">
        <span>1</span>
        <span>2</span>
        <span>3</span>
      </div>

      <div className="how-steps-grid">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <article className="how-step-card" key={step.title}>
              <div className="how-step-icon"><Icon size={23} /></div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <ul>
                {step.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProductFeaturesSection({ publicStats, onNewProject, onUpscale, onBgRemover }) {
  const completed = Number.isFinite(publicStats.completedExtractions)
    ? publicStats.completedExtractions.toLocaleString()
    : "--";

  return (
    <section id="tools" className="product-features-section" aria-label="DesaynClaw product features">
      <div className="product-features-heading">
        <h2>Product Features</h2>
        <p>Clean production tools for converting mockups, logos, and photos into usable print-ready files.</p>
      </div>

      <div className="product-features-grid">
        <article className="feature-card feature-card-tall">
          <div className="feature-icon-stack">
            <div className="feature-icon-badge">
              <img src="/favicon-feature.png" alt="" loading="lazy" />
            </div>
          </div>
          <div className="feature-card-copy">
            <h3>AI Production Workspace</h3>
            <p>
              Start from a raster image, isolate the artwork, clean the output, and prepare downloadable files without jumping between tools.
            </p>
          </div>
          <div className="feature-card-actions">
            <button type="button" onClick={onNewProject}>
              <FilePlus size={14} />
              New Project
            </button>
            <span className="feature-toggle" aria-hidden="true" />
          </div>
        </article>

        <article className="feature-card feature-card-mini feature-card-tools">
          <div>
            <h3>Tools Connected</h3>
            <p>Vectorize, Upscale, BG Remove</p>
          </div>
          <div className="feature-tool-row" aria-label="DesaynClaw tools">
            <span><ImageIcon size={15} /></span>
            <span><Scissors size={15} /></span>
            <span><Monitor size={15} /></span>
          </div>
        </article>

        <article className="feature-card feature-card-metric">
          <strong>4K</strong>
        </article>

        <article className="feature-card feature-card-mini">
          <div className="feature-card-inline">
            <div>
              <h3>Production Focus</h3>
              <p>SVG, PNG, ZIP exports</p>
            </div>
            <span className="feature-pill">Print Ready</span>
          </div>
          <div className="feature-percent">98%</div>
          <div className="feature-card-foot">
            <span>Clean handoff</span>
            <span>Fast revisions</span>
          </div>
        </article>

        <article className="feature-card feature-card-mini feature-card-copy-only">
          <h3>Client Delivery</h3>
          <p>Send polished files for sublimation, branding, and apparel work with fewer manual cleanup steps.</p>
        </article>

        <article className="feature-card feature-card-wide">
          <div>
            <h3>Workspace Shortcuts</h3>
            <p>Move faster through common production tasks.</p>
          </div>
          <div className="feature-key-row" aria-label="Workspace actions">
            <button type="button" onClick={onUpscale}>Upscale</button>
            <span>+</span>
            <button type="button" onClick={onBgRemover}>Remove BG</button>
          </div>
          <div className="feature-stat-strip">
            <span>{completed} extractions completed</span>
            <span>Auto-delete after 3 days</span>
          </div>
        </article>
      </div>
    </section>
  );
}

function AnimatedCounter({ value }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(value)) return;

    const target = Math.max(0, value);
    const start = count;
    const distance = target - start;

    if (distance === 0) return;

    const duration = 2500; // 2.5 seconds
    let startTime = null;
    let frameId = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percentage = Math.min(progress / duration, 1);

      const easeOut = percentage === 1 ? 1 : 1 - Math.pow(2, -10 * percentage);

      setCount(Math.round(start + (distance * easeOut)));

      if (progress < duration) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [value]);

  return (
    <div className="extraction-counter" style={{
      marginTop: "60px",
      padding: "56px 40px",
      background: "linear-gradient(180deg, rgba(14,14,14,0) 0%, rgba(18,18,18,0.85) 100%)",
      borderTop: "1px solid rgba(255,255,255,0.07)",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "22px"
    }}>
      {/* Monochrome Glass Pill Badge */}
      <div style={{
        color: "rgba(255,255,255,0.72)",
        fontSize: "10.5px",
        fontWeight: "700",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(255,255,255,0.13)",
        padding: "6px 18px",
        borderRadius: "100px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 14px rgba(0,0,0,0.35)"
      }}>
        Trusted Nationwide
      </div>

      {/* White-to-dark-grey metallic gradient number */}
      <div style={{
        fontSize: "clamp(88px, 9vw, 118px)",
        fontWeight: "600",
        fontFamily: "var(--font-manrope), 'Segoe UI', Arial, sans-serif",
        background: "linear-gradient(160deg, #ffffff 0%, #d4d4d8 38%, #71717a 80%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: "1.05",
        letterSpacing: "-2px",
        filter: "drop-shadow(0px 8px 22px rgba(0,0,0,0.45))"
      }}>
        {Number.isFinite(value) ? count.toLocaleString() : "--"}
      </div>

      {/* Description */}
      <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "15px", maxWidth: "400px", lineHeight: "1.65", fontWeight: "400" }}>
        Real completed SVG extractions from DesaynClaw projects.
      </div>
    </div>
  );
}

export default function StartScreen() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isMobileDevice = useIsMobileDevice();
  const fileInputRef = useRef(null);
  const bgRemoveInputRef = useRef(null);
  const homeRootRef = useRef(null);
  const publicStatsFetchRef = useRef({ inFlight: false, lastFetchAt: 0 });
  const dodoReturnHandledRef = useRef(false);

  const [syncSessionId, setSyncSessionId] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [isQrConnected, setIsQrConnected] = useState(false);

  // ─── Data State ─────────────────────────────────────────────────────────────
  const [recentProjects, setRecentProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);

  // ─── UI State ───────────────────────────────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [topUpInitialTab, setTopUpInitialTab] = useState("plans");
  const [unreadReferralRewards, setUnreadReferralRewards] = useState(0);
  const loginTriggerRef = useRef(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showDriveAnnouncement, setShowDriveAnnouncement] = useState(false);
  const [pendingFile, setPendingFile] = useState(null); // holds file waiting for type selection

  const openReferralModal = useCallback(() => {
    if (user?.id) markReferralPromptSeen(user.id);
    setShowReferralModal(true);
  }, [user?.id]);

  // ─── Modal Specific State ───────────────────────────────────────────────────
  const [modalProjectName, setModalProjectName] = useState("Untitled Design");
  const [modalTraceType, setModalTraceType] = useState("mockup_erase");
  const [projectToDelete, setProjectToDelete] = useState(null);

  // ─── Public Stats State ─────────────────────────────────────────────────────
  const [publicStats, setPublicStats] = useState({ totalUsers: 0, completedExtractions: null, reviewCount: 0, avatars: [] });
  const [publicStatsStatus, setPublicStatsStatus] = useState("unavailable");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);

  // ─── Initialization ─────────────────────────────────────────────────────────
  useEffect(() => {
    setShowDriveAnnouncement(localStorage.getItem(DRIVE_ANNOUNCEMENT_DISMISS_KEY) !== "1");
  }, []);

  useEffect(() => {
    const root = homeRootRef.current;
    if (!root?.classList.contains("has-guest-home")) return undefined;

    const sectionSelector = [
      ".home-content-frame > .workflow-preview-section",
      ".home-content-frame > .desktop-tools-shelf",
      ".home-content-frame .guest-landing-example",
      ".home-content-frame > .edu-demo-section",
      ".home-content-frame > .edu-cards-section",
      ".home-content-frame > .how-it-works-section",
      ".home-content-frame > .homepage-tutorial-section",
      ".home-content-frame > .product-features-section",
      ".home-content-frame > .tool-showcase-section",
      ".home-content-frame > .great-for-section",
      ".home-content-frame > .testimonial-showcase",
      ".home-content-frame #pricing",
      ".home-content-frame #faq",
    ].join(",");

    const sections = Array.from(root.querySelectorAll(sectionSelector));
    sections.forEach((section) => {
      section.classList.add("home-scroll-reveal");
      Array.from(section.children).forEach((piece, index) => {
        piece.classList.add("home-reveal-piece");
        piece.style.setProperty("--home-reveal-order", String(Math.min(index, 3)));
      });
    });

    root.classList.add("home-motion-ready");

    if (!("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-revealed"));
      return () => {
        root.classList.remove("home-motion-ready");
        sections.forEach((section) => {
          section.classList.remove("home-scroll-reveal", "is-revealed");
          Array.from(section.children).forEach((piece) => {
            piece.classList.remove("home-reveal-piece");
            piece.style.removeProperty("--home-reveal-order");
          });
        });
      };
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px",
    });

    sections.forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
      root.classList.remove("home-motion-ready");
      sections.forEach((section) => {
        section.classList.remove("home-scroll-reveal", "is-revealed");
        Array.from(section.children).forEach((piece) => {
          piece.classList.remove("home-reveal-piece");
          piece.style.removeProperty("--home-reveal-order");
        });
      });
    };
  }, [user]);

  const dismissDriveAnnouncement = () => {
    localStorage.setItem(DRIVE_ANNOUNCEMENT_DISMISS_KEY, "1");
    setShowDriveAnnouncement(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") !== "auth-failed") return;

    const authError = params.get("auth_error") || "";
    const authDescription = params.get("auth_error_description") || "";
    const lowerMessage = `${authError} ${authDescription}`.toLowerCase();
    let message = "Sign in failed. Please try again.";

    if (lowerMessage.includes("expired") || lowerMessage.includes("otp_expired")) {
      message = "Your sign-in link expired. Please request a new one.";
    } else if (lowerMessage.includes("missing_code")) {
      message = "That sign-in link is incomplete. Please start sign in again.";
    } else if (lowerMessage.includes("invalid_request") || lowerMessage.includes("redirect")) {
      message = "Sign in redirect is not allowed. Please check the Supabase redirect URL settings.";
    } else if (authDescription) {
      message = `Sign in failed: ${authDescription}`;
    }

    toast.error(message);
    setShowLoginModal(true);

    params.delete("error");
    params.delete("auth_error");
    params.delete("auth_error_description");
    const cleanQuery = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);
  }, []);

  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        analytics.authSession(session.user, { source: "home" });
        fetchRecentProjects(session.user.id);
        fetchCredits(session.user.id);
      } else {
        setIsLoadingProjects(false);
      }
    };
    fetchSession();

    const handleGlobalDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes("Files")) {
        setIsDraggingGlobal(true);
      }
    };
    window.addEventListener("dragover", handleGlobalDragOver);

    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
    };
  }, []);

  useEffect(() => {
    if (!user || dodoReturnHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const topUpResult = params.get("topup");
    if (topUpResult !== "dodo-return" && topUpResult !== "dodo-cancelled") return;

    dodoReturnHandledRef.current = true;
    let cancelled = false;

    const clearReturnParams = () => {
      params.delete("topup");
      params.delete("paymentId");
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    };

    if (topUpResult === "dodo-cancelled") {
      toast.info("Dodo checkout was cancelled. No Claws were charged.");
      clearReturnParams();
      return;
    }

    const paymentId = params.get("paymentId");
    if (!paymentId) {
      toast.info("Payment confirmation is still processing. Your Claws will appear automatically.");
      clearReturnParams();
      return;
    }

    const reconcilePayment = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Your session expired. Please sign in again.");

        for (let attempt = 0; attempt < 10 && !cancelled; attempt += 1) {
          const response = await fetch(
            `/api/payments/dodo/status?paymentId=${encodeURIComponent(paymentId)}`,
            { headers: { Authorization: `Bearer ${session.access_token}` } },
          );
          const result = await safeJson(response, "Failed to confirm Dodo payment");

          if (response.ok && result.status === "paid") {
            if (Number.isFinite(result.balance)) setCredits(result.balance);
            else fetchCredits(user.id);
            toast.success(`${result.credits} Claws added successfully.`);
            clearReturnParams();
            return;
          }
          if (response.ok && result.status === "failed") {
            toast.error("Dodo payment was not completed. No Claws were charged.");
            clearReturnParams();
            return;
          }
          if (!response.ok && response.status < 500) {
            throw new Error(result.error || "Failed to confirm Dodo payment");
          }

          await new Promise(resolve => setTimeout(resolve, 1500));
        }

        if (!cancelled) {
          toast.info("Payment is still confirming. Your Claws will be added automatically once Dodo completes it.");
          clearReturnParams();
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Dodo return reconciliation failed:", error);
          toast.error(error.message || "Could not confirm the Dodo payment yet. Please refresh shortly.");
          clearReturnParams();
        }
      }
    };

    reconcilePayment();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("topup")?.startsWith("dodo-")) return;

    const recoveryKey = `dodo-payment-recovery:${user.id}`;
    if (sessionStorage.getItem(recoveryKey) === "1") return;
    sessionStorage.setItem(recoveryKey, "1");
    let cancelled = false;

    const recoverPendingPayments = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const requestRecovery = (accessToken) => fetch("/api/payments/dodo/status", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        let response = await requestRecovery(session.access_token);

        // This is a best-effort background repair. The cached browser session
        // can expire between hydration and this request, so refresh once before
        // treating the response as a real reconciliation failure.
        if (response.status === 401 && !cancelled) {
          const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !refreshedSession?.access_token) {
            sessionStorage.removeItem(recoveryKey);
            return;
          }
          response = await requestRecovery(refreshedSession.access_token);
        }

        // A signed-out or invalidated session is not a payment error. A future
        // authenticated page load can safely retry the idempotent recovery.
        if (response.status === 401) {
          sessionStorage.removeItem(recoveryKey);
          return;
        }

        const result = await safeJson(response, "Failed to recover Dodo payments");
        if (!response.ok) throw new Error(result.error || "Failed to recover Dodo payments");
        if (!cancelled && result.status === "paid" && result.credits > 0) {
          if (Number.isFinite(result.balance)) setCredits(result.balance);
          else fetchCredits(user.id);
          toast.success(`Recovered ${result.credits} Claws from your completed Dodo payment.`);
        }
      } catch (error) {
        sessionStorage.removeItem(recoveryKey);
        console.warn("Dodo pending-payment recovery was deferred:", error);
      }
    };

    recoverPendingPayments();
    return () => { cancelled = true; };
  }, [user]);

  // Handle QR Sync Session Generation
  useEffect(() => {
    if (typeof window !== "undefined") {
      let syncId = localStorage.getItem("globalSyncSessionId");
      if (!syncId) {
        syncId = crypto.randomUUID();
        localStorage.setItem("globalSyncSessionId", syncId);
      }
      setSyncSessionId(syncId);
    }
  }, []);

  // Handle Routed Mobile Image
  useEffect(() => {
    const checkPendingImage = async () => {
      const pendingUrl = sessionStorage.getItem("pendingMobileImage");
      if (pendingUrl && user) {
        sessionStorage.removeItem("pendingMobileImage");
        setIsQrConnected(true);
        setShowQrModal(false);

        try {
          const response = await fetch(pendingUrl);
          const blob = await response.blob();
          const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
          const file = new File([blob], "mobile-upload.jpg", { type: mimeType });

          const mobileTraceType = sessionStorage.getItem("mobileTraceType");
          if (mobileTraceType) {
            sessionStorage.removeItem("mobileTraceType");
            handleFileUpload(file, mobileTraceType === "bg_remover", mobileTraceType);
          } else {
            handleFileUpload(file);
          }
        } catch (error) {
          console.error("Failed to process routed mobile upload:", error);
          analytics.error(error, { area: "mobile_upload_routing" });
          toast.error("Failed to load received image.");
        }
      }
    };

    checkPendingImage();
    const handleEvent = () => checkPendingImage();
    window.addEventListener("mobileImageRouted", handleEvent);

    return () => {
      window.removeEventListener("mobileImageRouted", handleEvent);
    };
  }, [user]);

  // Fetch Public Stats — re-fetch whenever user returns to this tab/page
  useEffect(() => {
    const fetchStats = () => {
      const now = Date.now();
      if (publicStatsFetchRef.current.inFlight || now - publicStatsFetchRef.current.lastFetchAt < 60_000) {
        return;
      }
      publicStatsFetchRef.current.inFlight = true;
      publicStatsFetchRef.current.lastFetchAt = now;

      const statsController = new AbortController();
      const statsTimeout = setTimeout(() => statsController.abort(), 6500);

      const applyCachedStats = () => {
        try {
          const cached = JSON.parse(localStorage.getItem(PUBLIC_STATS_CACHE_KEY) || "null");
          if (cached && Number.isFinite(cached.totalUsers)) {
            setPublicStats({
              totalUsers: cached.totalUsers || 0,
              completedExtractions: Number.isFinite(cached.completedExtractions) ? cached.completedExtractions : 0,
              reviewCount: cached.reviewCount || 0,
              avatars: cached.avatars || []
            });
            setPublicStatsStatus("cached");
            return true;
          }
        } catch (cacheError) {
          console.warn("Failed to read cached public stats", cacheError);
        }
        return false;
      };

      fetch('/api/public-stats', { signal: statsController.signal })
        .then(res => {
          if (!res.ok) return { success: false };
          return safeJson(res, "Failed to load public stats");
        })
        .then(data => {
          if (data.success) {
            const nextStats = {
              totalUsers: data.totalUsers || 0,
              completedExtractions: Number.isFinite(data.completedExtractions) ? data.completedExtractions : 0,
              reviewCount: data.reviewCount || 0,
              avatars: data.avatars || []
            };
            setPublicStats(nextStats);
            setPublicStatsStatus("ready");
            localStorage.setItem(PUBLIC_STATS_CACHE_KEY, JSON.stringify(nextStats));
          } else {
            if (!applyCachedStats()) setPublicStatsStatus("unavailable");
          }
        })
        .catch((error) => {
          const hasCachedStats = error?.name !== "AbortError" && applyCachedStats();
          if (!hasCachedStats) setPublicStatsStatus("unavailable");
        })
        .finally(() => {
          clearTimeout(statsTimeout);
          publicStatsFetchRef.current.inFlight = false;
        });
    };

    fetchStats(); // initial load

    // Re-fetch when user switches back to this tab (catches new sign-ups immediately)
    const handleVisibility = () => { if (document.visibilityState === "visible") fetchStats(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", fetchStats);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", fetchStats);
    };
  }, []);

  const fetchCredits = async (userId) => {
    const { data } = await supabase.from("profiles").select("credits, created_at").eq("id", userId).single();
    if (data) {
      setCredits(data.credits);
      const isNew = data.created_at && (Date.now() - new Date(data.created_at).getTime()) < 60000;
      if (isNew && !localStorage.getItem("onboarding_seen")) {
        setShowOnboarding(true);
        localStorage.setItem("onboarding_seen", "1");
      }
    }
  };

  const fetchRecentProjects = async (userId) => {
    setIsLoadingProjects(true);

    // Only fetch projects from the last 3 days since R2 objects are auto-deleted after 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", threeDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) setRecentProjects(data);
    setIsLoadingProjects(false);
  };

  // ─── Auth Handlers ──────────────────────────────────────────────────────────
  const handleLogin = (event) => {
    if (event?.currentTarget instanceof HTMLElement) {
      loginTriggerRef.current = event.currentTarget;
    }
    setShowLoginModal(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    analytics.reset();
    setUser(null);
    setRecentProjects([]);
  };

  // ─── Project Actions ────────────────────────────────────────────────────────
  const saveRename = async (e, id) => {
    e.stopPropagation();
    if (!editValue.trim() || editValue === recentProjects.find(p => p.id === id).name) {
      setEditingId(null);
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/project", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: id, newName: editValue })
      });
      if (res.ok) setRecentProjects(prev => prev.map(p => p.id === id ? { ...p, name: editValue } : p));
    } catch (err) {
      console.error("Failed to rename", err);
      analytics.error(err, { area: "project_rename" });
    }
    setEditingId(null);
  };

  const deleteProject = async () => {
    if (!projectToDelete) return;
    const id = projectToDelete.id;
    setRecentProjects(prev => prev.filter(p => p.id !== id));
    setProjectToDelete(null);
    setOpenMenuId(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(`/api/project?id=${id}`, {
        method: "DELETE",
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Delete failed (${response.status})`);
      }
    } catch (err) {
      console.error("Failed to delete", err);
      analytics.error(err, { area: "project_delete" });
      toast.error("Project could not be deleted. It has been restored to your list.");
      fetchRecentProjects(user?.id);
    }
  };

  // ─── Upload Logic ───────────────────────────────────────────────────────────
  const handleFileUpload = async (file, isBgRemover = false, mobileTraceType = null) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (isMobileDevice) {
      toast.info("Desktop required: please use a computer or laptop to process designs.");
      return;
    }

    const finalTraceType = isBgRemover ? "bg_remover" : (mobileTraceType || modalTraceType);
    const uploadPurpose = finalTraceType === "bg_remover" ? "bg_remover" : "standard";
    const maxUploadBytes = resolveImageUploadLimit({ purpose: uploadPurpose });
    if (file.size > maxUploadBytes) {
      toast.error(`File is too large! Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      return;
    }

    setIsUploading(true);
    try {
      // 1. Compress Image
      let fileToUpload = file;
      try {
        fileToUpload = await compressImageClientSide(file, 2048, 0.85); // 2048px max, 85% quality
      } catch (compressErr) {
        console.warn("Compression failed, uploading original:", compressErr);
      }

      if (fileToUpload.size > maxUploadBytes) {
        toast.error(`Compressed file is still too large. Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) { setIsUploading(false); handleLogin(); return; }

      const imageUrl = await uploadImageToStorage({
        token,
        file: fileToUpload,
        purpose: uploadPurpose,
      });

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` // Required: server verifies user server-side
        },
        body: JSON.stringify({
          imageUrl,
          projectName: isBgRemover ? fileToUpload.name.replace(/\.[^/.]+$/, "") : (modalProjectName || file.name),
          traceType: finalTraceType
          // userId intentionally omitted — server reads from verified token
        })
      });

      const data = await safeJson(response, "Project creation failed");
      if (!response.ok) throw new Error(data.details || data.error || "Project creation failed");

      if (finalTraceType === "bg_remover") {
        router.push(`/bg-remover/${data.projectId}`);
      } else {
        router.push(`/workspace/${data.projectId}`);
      }
    } catch (error) {
      console.error("Upload error:", error);
      analytics.error(error, { area: "project_upload", trace_type: isBgRemover ? "bg_remover" : (mobileTraceType || modalTraceType) });
      toast.error("Failed to create project: " + error.message);
      setIsUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!user) { setShowLoginModal(true); return; }
    if (e.dataTransfer.files?.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  };

  // Open type-selection modal with a pre-selected file (from drop or file picker)
  const openModalWithFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (isMobileDevice) {
      toast.info("Desktop required: workspace tools are available on computer or laptop only.");
      return;
    }
    if (!user) { setShowLoginModal(true); return; }
    const maxSizeInMB = 10;
    if (file.size > maxSizeInMB * 1024 * 1024) {
      toast.error(`File is too large! Maximum allowed size is ${maxSizeInMB}MB.`);
      return;
    }
    setPendingFile(file);
    setShowModal(true);
  };

  const requireDesktopTool = () => {
    if (!isMobileDevice) return false;
    toast.info("Desktop required: please use a computer or laptop to open DesaynClaw tools.");
    return true;
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={homeRootRef} id="start" className={`start-screen-container${user ? "" : " has-guest-home"}`} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => setOpenMenuId(null)}>
      {user && <h1 style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
        DesaynClaw AI Vector Tracer and Sublimation Design Extractor
      </h1>}
      {/* Global Drag & Drop Overlay */}
      {isDraggingGlobal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.95)", zIndex: 99999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "4px dashed #FFD700" }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setIsDraggingGlobal(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingGlobal(false);
            if (e.dataTransfer.files?.length > 0) {
              openModalWithFile(e.dataTransfer.files[0]);
            }
          }}
        >
          <div style={{ background: "#FFD700", padding: "24px", borderRadius: "50%", marginBottom: "24px" }}><ImageIcon size={48} color="#000" /></div>
          <h2 style={{ color: "#FFD700", fontSize: "32px", margin: 0, fontWeight: "800" }}>Drop your image anywhere</h2>
          <p style={{ color: "#aaa", fontSize: "16px", marginTop: "12px" }}>Release to start tracing instantly.</p>
        </div>
      )}

      {/* Top Navigation Bar */}
      {user && <header className="home-topbar">

        <div className="home-topbar-inner">
          <button className="home-topbar-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Return to the top of your workspace">
            <img src="/nav bar logo.png" alt="DesaynClaw" />
          </button>

          {/* Right: Auth & Credits */}
          <div className="home-account-actions">
            {user ? (
              <>
                <button
                  className="home-tutorial-button"
                  type="button"
                  onClick={() => document.getElementById("how-desaynclaw-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  aria-label="Scroll to the DesaynClaw tutorial"
                >
                  <Play size={13} fill="currentColor" aria-hidden="true" /> Tutorial <span>5 min</span>
                </button>
                <button
                  className="home-referral-button"
                  type="button"
                  onClick={openReferralModal}
                  aria-label="Open Refer and Earn"
                >
                  <Gift size={14} aria-hidden="true" />
                  <span>Refer &amp; Earn</span>
                </button>
                {/* Premium Credits Badge */}
                <button
                  className="home-credit-pill"
                  type="button"
                  onClick={() => { setTopUpInitialTab("plans"); setShowTopUpModal(true); }}
                  aria-label={`${credits} Claws available${unreadReferralRewards > 0 ? `. ${unreadReferralRewards} new referral reward${unreadReferralRewards > 1 ? "s" : ""}` : ". Add more Claws"}`}
                >
                  <img src="/Claws/Claws.webp" alt="Claws" style={{ width: "14px", height: "14px", objectFit: "contain" }} />
                  <span className="home-credit-count">{credits}</span>
                  <span className="home-credit-label">Claws</span>
                  {unreadReferralRewards > 0 && (
                    <span className="home-credit-reward-badge" aria-hidden="true">
                      +{unreadReferralRewards}
                    </span>
                  )}
                </button>

                {/* Profile Pill */}
                <div className="home-profile-pill">
                  {user.user_metadata?.avatar_url ? (
                    <img src={user.user_metadata.avatar_url} referrerPolicy="no-referrer" alt="" />
                  ) : <div className="home-profile-placeholder"><User size={14} aria-hidden="true" /></div>}
                  <span>{user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}</span>
                </div>

                {/* Logout Icon Button */}
                <button className="home-logout-button" type="button" onClick={handleLogout} title="Log out" aria-label="Log out">
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button onClick={handleLogin} className="start-btn" style={{ background: "#FFD700", color: "#000", borderColor: "#FFD700", display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", padding: "8px 16px", borderRadius: "0", textTransform: "uppercase", letterSpacing: "1px" }}>
                <LogIn size={16} /> Log In
              </button>
            )}
          </div>
        </div>
      </header>}

      {showDriveAnnouncement && !showReferralModal && (
        <section className="home-announcement-banner" aria-label="Google Drive integration announcement">
          <div className="home-announcement-inner">
            <div className="home-announcement-icon" aria-hidden="true">
              <img src="/Google_Drive_Logo_05.2026.png" alt="" />
            </div>
            <p>
              <span>New</span>
              Google Drive export is now available — save finished SVG, PNG, and ZIP project files straight to your Drive folder.
            </p>
            <button
              type="button"
              className="home-announcement-close"
              onClick={dismissDriveAnnouncement}
              aria-label="Dismiss announcement"
            >
              <X size={13} />
            </button>
          </div>
        </section>
      )}

      {/* FULL WIDTH HERO SECTION */}
      {!user && (
        <GuestHomepageHero
          onStart={handleLogin}
          publicStats={publicStats}
        />
      )}
      {user && <div className="home-hero-shell" style={{ position: "relative", width: "calc(100% + 40px)", marginLeft: "-20px", marginRight: "-20px", background: "#1a1a1a", paddingTop: "100px", paddingBottom: "40px", color: "#fff" }}>
        <div className="home-hero-inner" style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 20px", position: "relative", zIndex: 2 }}>

          <div className="hero-section" style={{ justifyContent: "flex-start", margin: 0 }}>
            {/* LOGO AND UPLOAD BOX (ALWAYS VISIBLE) */}
            <div className="hero-left" style={{ margin: "0" }}>
              <div className="start-logo" style={{ marginBottom: "30px", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "350px", maxWidth: "100%", height: "auto", margin: 0 }} />

                {/* Refined byline */}
                <div className="hero-byline" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                  <span style={{ width: "20px", height: "1px", background: "rgba(255,255,255,0.15)", display: "inline-block" }} />
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", fontWeight: "500", letterSpacing: "2.5px", textTransform: "uppercase" }}>Developed by Desaynbro</span>
                  <span style={{ width: "20px", height: "1px", background: "rgba(255,255,255,0.15)", display: "inline-block" }} />
                </div>

                {/* PUBLIC STATS — compact single-pill row */}
                {(publicStats.totalUsers > 0 || publicStatsStatus !== "ready") && (
                  <div className="public-stats-pill" style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0",
                    marginTop: "24px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "100px",
                    padding: "6px 14px 6px 6px",
                  }}>
                    {/* Avatar stack */}
                    {publicStats.avatars.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", marginRight: "10px" }}>
                        {publicStats.avatars.map((url, i) => (
                        <img key={i} src={url} alt="User" style={{ width: "28px", height: "28px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.08)", marginLeft: i > 0 ? "-9px" : "0", backgroundColor: "#2a2a2a", objectFit: "cover", zIndex: 10 - i }} />
                        ))}
                      </div>
                    )}

                    {/* User count */}
                    {publicStats.totalUsers > 0 ? (
                      <>
                        <span style={{ fontSize: "13px", color: "#fff", fontWeight: "600", marginRight: "6px" }}>
                          {publicStats.totalUsers.toLocaleString()}+
                        </span>
                        <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", fontWeight: "400", marginRight: "10px" }}>
                          creatives
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", fontWeight: "500", marginLeft: "8px", marginRight: "10px" }}>
                        {publicStatsStatus === "unavailable" ? "Live stats unavailable locally" : "Loading community stats"}
                      </span>
                    )}

                    {/* Dot divider */}
                    {publicStats.reviewCount > 0 && (
                      <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "inline-block", marginRight: "10px" }} />
                    )}

                    {/* Stars */}
                    {publicStats.reviewCount > 0 && (
                      <>
                        <div style={{ display: "flex", gap: "2px", marginRight: "5px" }}>
                          {[1, 2, 3, 4, 5].map((_, i) => (
                            <svg key={i} width="11" height="11" viewBox="0 0 24 24" fill="#FFD700" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                            </svg>
                          ))}
                        </div>
                        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: "400" }}>
                          {publicStats.reviewCount} reviews
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Description */}
                <p className="hero-copy" style={{ fontSize: "15px", color: "rgba(255,255,255,0.55)", textAlign: "center", marginTop: "20px", maxWidth: "500px", lineHeight: "1.65", textWrap: "balance", fontWeight: "400" }}>
                  Instantly transform your raster images (PNG, JPG) into ultra-clean, scalable vector graphics (SVG) using our advanced AI neural engine.
                </p>
              </div>

              <div className="hero-action-bar" style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "20px", width: "100%", overflow: "visible", paddingBottom: "2px" }}>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } setShowModal(true); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  {isUploading ? <><Monitor size={13} className="animate-pulse" /> Creating...</> : <><FilePlus size={13} /> New Project</>}
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } fileInputRef.current.click(); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  {isUploading ? <><Monitor size={13} className="animate-pulse" /> Uploading...</> : <><Monitor size={13} /> Open PC</>}
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } setShowQrModal(true); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  <Scan size={13} /> Scan Phone
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } router.push('/upscale'); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  <ImageIcon size={13} /> Image Upscale
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } bgRemoveInputRef.current.click(); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#FFD700", border: "1px solid rgba(255, 215, 0, 0.4)", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "700", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px", boxShadow: "0 0 10px rgba(255,215,0,0.1)" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,215,0,0.1)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Scissors size={13} color="#FFD700" /> BG Remover
                </button>
              </div>

              <div className="hero-upload-box"
                style={{ flex: 1, background: "#2a2a2a", padding: "30px", borderRadius: "0", border: "2px dashed #444", boxShadow: "none", textAlign: "center" }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files?.length > 0) {
                    openModalWithFile(e.dataTransfer.files[0]);
                  }
                }}
              >
                <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <input type="checkbox" id="aiEnhance" defaultChecked style={{ width: "16px", height: "16px", accentColor: "#FFD700" }} />
                  <label htmlFor="aiEnhance" style={{ fontSize: "14px", color: "#ccc", cursor: "pointer" }}><strong>Enhance image with AI</strong> (Removes noise)</label>
                </div>

                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } fileInputRef.current.click(); }} disabled={isUploading} style={{ background: "transparent", color: "#e0e0e0", border: "1px solid #444", borderRadius: "0", fontSize: "16px", padding: "16px 24px", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontWeight: "500", transition: "all 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.background = "#333"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  {isUploading ? <><Monitor size={18} className="animate-pulse" /> Uploading...</> : <><Monitor size={18} /> Upload Images</>}
                </button>
                <div style={{ marginTop: "15px", display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                  <span style={{ color: "#888", fontSize: "14px" }}>or drop an image</span>
                  <span style={{ color: "#555", fontSize: "12px", fontFamily: "var(--font-manrope), 'Segoe UI', Arial, sans-serif" }}>.png, .jpg, .jpeg, .webp</span>
                </div>
              </div>
            </div>

            {/* RIGHT PANEL — Recent Projects (logged in) OR Sample Extractions (guest) */}
            {user ? (
              <div className="hero-right">
                <RecentProjects
                  user={user}
                  isLoadingProjects={isLoadingProjects}
                  recentProjects={recentProjects}
                  editingId={editingId}
                  editValue={editValue}
                  setEditValue={setEditValue}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  onNavigate={(proj) => {
                    if (proj.trace_type === "bg_remover") router.push(`/bg-remover/${proj.id}`);
                    else router.push(`/workspace/${proj.id}`);
                  }}
                  onStartEditing={(e, proj) => { e.stopPropagation(); setOpenMenuId(null); setEditingId(proj.id); setEditValue(proj.name); }}
                  onCancelEditing={(e) => { e.stopPropagation(); setEditingId(null); }}
                  onSaveRename={saveRename}
                  onConfirmDelete={(e, proj) => { e.stopPropagation(); setProjectToDelete(proj); }}
                />
              </div>
            ) : (
              <div className="hero-right" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
                  <BeforeAfterSlider
                    title="Untitled Design 2"
                    rasterUrl="/samples/Reference.png"
                    vectorUrl="/samples/DesaynClaw_Tshirt_Design_4K.webp"
                    height="220px"
                    objectPosition="center 40%"
                  />
                  <BeforeAfterSlider
                    title="Polo Shirt Pattern"
                    rasterUrl="/samples/polo-original.png"
                    vectorUrl="/samples/polo-vector.webp"
                    height="220px"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CURVED WAVE SVG DIVIDER (Matching the app background) */}
        <div style={{ position: "absolute", bottom: "-1px", left: 0, width: "100%", overflow: "hidden", lineHeight: 0 }}>
          <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", width: "100%", height: "auto" }}>
            <path fill="#262626" fillOpacity="1" d="M0,160L48,170.7C96,181,192,203,288,197.3C384,192,480,160,576,149.3C672,139,768,149,864,170.7C960,192,1056,224,1152,213.3C1248,203,1344,149,1392,122.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
          </svg>
        </div>
      </div>}

      {/* Main Content Wrapper (For the rest of the page) */}
      <main
        className={`home-content-frame${showQrModal ? " has-qr-sync-modal" : ""}`}
        style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 20px", width: "100%" }}
      >

        {user && <HomeTrustMarquee />}

        {user && (
          <HomepageWorkflowPreview
            onStart={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowModal(true);
            }}
          />
        )}

        {user && (
          <DesktopToolsShelf
            onExtract={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowModal(true);
            }}
            onUpscale={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              router.push('/upscale');
            }}
            onBgRemover={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              bgRemoveInputRef.current.click();
            }}
            onMockupStudio={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              router.push('/mockup-studio');
            }}
          />
        )}

        {!user && (
          <HomepageWorkflowPreview
            onStart={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowLoginModal(true);
            }}
          />
        )}

        {!user && (
          <DesktopToolsShelf
            onExtract={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowLoginModal(true);
            }}
            onUpscale={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowLoginModal(true);
            }}
            onBgRemover={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowLoginModal(true);
            }}
            onMockupStudio={(e) => {
              e?.stopPropagation?.();
              if (requireDesktopTool()) return;
              setShowLoginModal(true);
            }}
          />
        )}

        {!user && <GuestHomepageSampleSection />}

        <EduSection />

        <HowItWorksSection />

        <HomepageTutorialSection />

        <ProductFeaturesSection
          publicStats={publicStats}
          onNewProject={(e) => {
            e?.stopPropagation?.();
            if (requireDesktopTool()) return;
            if (!user) { setShowLoginModal(true); return; }
            setShowModal(true);
          }}
          onUpscale={(e) => {
            e?.stopPropagation?.();
            if (requireDesktopTool()) return;
            if (!user) { setShowLoginModal(true); return; }
            router.push('/upscale');
          }}
          onBgRemover={(e) => {
            e?.stopPropagation?.();
            if (requireDesktopTool()) return;
            if (!user) { setShowLoginModal(true); return; }
            bgRemoveInputRef.current.click();
          }}
        />

        {/* BG Remover Sample Section */}
        <section className="tool-showcase-section section-line-accent">
          <div className="tool-showcase-copy">
            <span className="section-kicker">AI Background Remover</span>
            <h2>Flawless Subject Cutouts</h2>
            <p>
              Slide to see how our AI perfectly removes complex backgrounds, including fine details like hair, fur, and difficult edges. Get precise cutouts in seconds without manual tracing.
            </p>
            <button
              className="tool-showcase-button is-primary"
              onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } bgRemoveInputRef.current.click(); }}
            >
              <Scissors size={18} color="#000" />
              Try Background Remover
            </button>
          </div>
          <div className="tool-showcase-media">
            <BeforeAfterSlider
              rasterUrl="/samples/f3fe3b3f-bf6f-4182-9cc8-79a5a8204c6c.webp"
              vectorUrl="/samples/DesaynClaw_f3fe3b3f-bf6f-4182-9cc8-79a5a8204c6c_Transparent.webp"
              leftLabel="NO BACKGROUND"
              rightLabel="ORIGINAL"
              layout="vertical"
              aspectRatio="1 / 1"
              showCheckerboard={true}
            />
          </div>
        </section>

        {/* Upscaler Sample Section */}
        <section className="tool-showcase-section is-reversed section-line-accent">
          <div className="tool-showcase-copy">
            <span className="section-kicker">AI Image Upscaler</span>
            <h2>Enhance to 4K Quality</h2>
            <p>
              Recover lost details, sharpen blurry edges, and magically enhance low-resolution images. Slide to see the crystal clear difference when upgrading to 4K resolution.
            </p>
            <button
              className="tool-showcase-button"
              onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } router.push('/upscale'); }}
            >
              <ImageIcon size={18} />
              Try Image Upscaler
            </button>
          </div>
          <div className="tool-showcase-media">
            <BeforeAfterSlider
              rasterUrl="/samples/upscale-original.png"
              vectorUrl="/samples/upscale-hq.webp"
              leftLabel="4K UPSCALE"
              rightLabel="PIXELATED"
              layout="vertical"
              aspectRatio="1 / 1"
              pixelateRaster={true}
            />
          </div>
        </section>

        {/* ─── GREAT FOR SECTION ────────────────────────────────────────────── */}
        <section className="great-for-section section-line-accent">

          {/* Section Header */}
          <div className="great-for-heading">
            <span className="section-kicker">
              <span className="great-for-kicker-dot" />
              Great For
            </span>
            <h2>Built for <em>everyday production</em> work</h2>
            <p className="great-for-subtitle">
              From sublimation print shops to freelance designers — DesaynClaw handles the heavy lifting so you can focus on delivering clean, production-ready files faster.
            </p>
          </div>

          {/* Cards Grid */}
          <div className="great-for-grid">

            {/* Card 1 — Sublimation Print Shops */}
            <article className="great-for-card">
              <div className="great-for-card-top">
                <div className="great-for-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                </div>
                <span className="great-for-tag">Print Ready</span>
              </div>
              <div className="great-for-card-body">
                <h3>Sublimation Print Shops</h3>
                <p>Extract flat sublimation-ready files from jersey mockups. Save hours of manual Photoshop work. Output clean, print-ready rectangles straight to your RIP software.</p>
              </div>
            </article>

            {/* Card 2 — Logos & Branding */}
            <article className="great-for-card">
              <div className="great-for-card-top">
                <div className="great-for-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                </div>
                <span className="great-for-tag">SVG Export</span>
              </div>
              <div className="great-for-card-body">
                <h3>Logos &amp; Branding</h3>
                <p>Vectorize low-resolution logos into crisp, scalable SVGs. Enhance old or blurry brand marks into professional vector files ready for Illustrator, CorelDRAW, or embroidery.</p>
              </div>
            </article>

            {/* Card 3 — School & Sports Uniforms */}
            <article className="great-for-card">
              <div className="great-for-card-top">
                <div className="great-for-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                </div>
                <span className="great-for-tag">Team Orders</span>
              </div>
              <div className="great-for-card-body">
                <h3>School &amp; Sports Uniforms</h3>
                <p>Reproduce barangay, basketball, volleyball, and school uniform designs from mockup photos. Get editable flat files for any sport without touching the original artwork.</p>
              </div>
            </article>

            {/* Card 4 — Freelance Designers */}
            <article className="great-for-card">
              <div className="great-for-card-top">
                <div className="great-for-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" /></svg>
                </div>
                <span className="great-for-tag">Freelance</span>
              </div>
              <div className="great-for-card-body">
                <h3>Freelance Designers</h3>
                <p>Remove backgrounds, upscale to 4K, and vectorize client artwork in minutes. Take on more orders and deliver faster without sacrificing quality.</p>
              </div>
            </article>

          </div>

        </section>

        {/* Animated Counter Section */}
        <TestimonialSection />

        <AnimatedCounter value={publicStats.completedExtractions} />

        {!user && <GuestHomepageConversionSections onStart={handleLogin} />}

        <div className="site-closing-surface">
        <FAQSection />

        {/* ────────────────────────────────────────────────────────────────────── */}

        {/* Hidden File Input — shows type-selector modal before uploading */}
        <input type="file" ref={fileInputRef} onChange={(e) => { if (e.target.files[0]) openModalWithFile(e.target.files[0]); e.target.value = ""; }} accept="image/*" style={{ display: "none" }} />
        <input type="file" ref={bgRemoveInputRef} onChange={(e) => { if (e.target.files[0]) { if (requireDesktopTool()) { e.target.value = ""; return; } handleFileUpload(e.target.files[0], true); } e.target.value = ""; }} accept="image/*" style={{ display: "none" }} />

        {/* ─── Modals ────────────────────────────────────────────────────────── */}
        <NewProjectModal
          show={showModal}
          projectName={modalProjectName} setProjectName={setModalProjectName}
          traceType={modalTraceType} setTraceType={setModalTraceType}
          isUploading={isUploading}
          onClose={() => { setShowModal(false); setPendingFile(null); }}
          onSelectImage={() => {
            if (requireDesktopTool()) return;
            if (pendingFile) {
              handleFileUpload(pendingFile);
            } else {
              fileInputRef.current.click();
            }
          }}
          onSelectBgRemover={() => {
            if (requireDesktopTool()) return;
            bgRemoveInputRef.current.click();
          }}
          onSelectMockupStudio={() => {
            if (requireDesktopTool()) return;
            router.push("/mockup-studio");
          }}
        />

        <OnboardingModal
          show={showOnboarding}
          onClose={() => setShowOnboarding(false)}
        />

        {showTopUpModal && (
          <TopUpModal
            show={showTopUpModal}
            user={user}
            supabase={supabase}
            initialTab={topUpInitialTab}
            onClose={() => setShowTopUpModal(false)}
            onLoginRequired={() => { setShowTopUpModal(false); setShowLoginModal(true); }}
          />
        )}

        <LoginModal
          show={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          supabase={supabase}
          returnFocusRef={loginTriggerRef}
        />

        <ReferralModal
          show={showReferralModal}
          onClose={() => setShowReferralModal(false)}
          supabase={supabase}
        />

        <ReferralPromptController
          user={user}
          supabase={supabase}
          blocked={Boolean(
            showReferralModal || showModal || showTopUpModal || showLoginModal
            || showOnboarding || showQrModal || isUploading
          )}
          onOpen={openReferralModal}
        />

        <ClawRewardNotice
          user={user}
          supabase={supabase}
          blocked={Boolean(
            showReferralModal || showModal || showTopUpModal || showLoginModal
            || showOnboarding || showQrModal || isUploading
          )}
          onBalanceChange={setCredits}
          onUnreadChange={setUnreadReferralRewards}
          onViewActivity={() => {
            setTopUpInitialTab("history");
            setShowTopUpModal(true);
          }}
        />

        {/* Delete Confirmation Modal */}
        {projectToDelete && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "400px", textAlign: "center" }}>
              <div className="modal-icon text-danger" style={{ marginBottom: "15px" }}>
                <Trash2 size={48} strokeWidth={1} color="#ff4444" />
              </div>
              <h3 style={{ marginBottom: "10px" }}>Delete Project?</h3>
              <p style={{ color: "#888", marginBottom: "25px", fontSize: "13px" }}>
                Are you sure you want to delete <strong>"{projectToDelete.name}"</strong>? This will permanently remove the project and its files from the cloud. This action cannot be undone.
              </p>
              <div className="modal-actions" style={{ justifyContent: "center" }}>
                <button className="btn-secondary" onClick={() => setProjectToDelete(null)}>Cancel</button>
                <button className="btn-primary bg-danger" style={{ backgroundColor: "#ff4444", color: "#fff" }} onClick={deleteProject}>Delete Forever</button>
              </div>
            </div>
          </div>
        )}

        {/* QR Sync Modal */}
        {showQrModal && (
          <div className="modal-overlay qr-sync-overlay" onClick={() => setShowQrModal(false)}>
            <div className="modal-content qr-sync-modal" onClick={(e) => e.stopPropagation()}>

              {/* Minimal Close Button */}
              <button
                onClick={() => setShowQrModal(false)}
                className="qr-sync-close"
                style={{
                  position: "absolute",
                  top: "16px",
                  right: "16px",
                  background: "none",
                  border: "none",
                  color: "#666",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.background = "none"; }}
              >
                <X size={20} />
              </button>

              <h3 className="qr-sync-title">Scan to Upload</h3>
              <p className="qr-sync-copy">
                Point your phone's camera at this QR code. Take a picture of your logo or business card, and it will magically appear here.
              </p>

              <div className="qr-sync-code">
                <QRCode
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/mobile?sync=${syncSessionId}`}
                  size={220}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="H"
                />
              </div>

              {isQrConnected ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#22c55e" }}>
                  <CheckCircle2 size={18} /> <span style={{ fontWeight: "bold" }}>Receiving Image...</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#888" }}>
                  <Monitor size={16} className="animate-pulse" /> <span>Waiting for your phone...</span>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Uploading Overlay */}
        {isUploading && !showModal && (
          <div className="modal-overlay" style={{ zIndex: 9999 }}>
            <div className="modal-content" style={{ maxWidth: "340px", textAlign: "center", padding: "40px 30px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <LogoLoader size={64} color="#FFD700" />
              <div style={{ fontSize: "16px", color: "#fff", fontWeight: "600", marginBottom: "8px" }}>Preparing Image...</div>
              <p style={{ color: "#aaa", margin: 0, fontSize: "13px", lineHeight: "1.6" }}>
                Transferring your photo to the workspace.
              </p>
            </div>
          </div>
        )}

        <section className="prefooter-cta" aria-labelledby="prefooter-cta-heading">
          <Image className="prefooter-cta-logo" src="/logo.png" alt="DesaynClaw" width={220} height={54} />
          <span className="prefooter-cta-kicker">Production tools for real artwork</span>
          <h2 id="prefooter-cta-heading">Turn rough artwork into production-ready files.</h2>
          <p>Trace, clean up, remove backgrounds, and upscale client artwork in one focused workspace.</p>
          <button type="button" onClick={() => { if (!user) { setShowLoginModal(true); return; } setShowModal(true); }}>
            Start designing <span><ArrowUpRight size={18} aria-hidden="true" /></span>
          </button>
          <small>Private by default <i aria-hidden="true" /> No subscription required <i aria-hidden="true" /> Auto-deleted after 3 days</small>
        </section>
        <footer className="site-footer">
          <div className="site-footer-main">
            <div className="site-footer-brand">
              <img src="/logo.png" alt="DesaynClaw Logo" />
              <p>AI-powered production tools for clean SVG tracing, background removal, upscaling, and print-ready artwork delivery.</p>
              <div className="site-footer-socials" aria-label="DesaynClaw social links">
                <a href="https://www.facebook.com/profile.php?id=61564332563389" target="_blank" rel="noreferrer" aria-label="Follow DesaynClaw on Facebook" title="Facebook">
                  <Image src="/social/facebook.svg" alt="" width={18} height={18} aria-hidden="true" />
                </a>
                <a href="https://www.instagram.com/desaynclaw/" target="_blank" rel="noreferrer" aria-label="Follow DesaynClaw on Instagram" title="Instagram">
                  <Image src="/social/instagram.svg" alt="" width={18} height={18} aria-hidden="true" />
                </a>
                <a href="https://ph.linkedin.com/in/lloyd-dumz-a8a754370" target="_blank" rel="noreferrer" aria-label="Follow DesaynClaw founder on LinkedIn" title="LinkedIn">
                  <Image src="/social/linkedin.svg" alt="" width={18} height={18} aria-hidden="true" />
                </a>
              </div>
            </div>

            <nav className="site-footer-links" aria-label="Footer links">
              <div>
                <h3>Resources</h3>
                <a href="/privacy">Privacy Policy</a>
                <a href="/terms">Terms of Service</a>
                <a href="/refunds">Refund Policy</a>
                <a href="/#faq">FAQ</a>
              </div>
              <div>
                <h3>Company</h3>
                <a href="/team">Team</a>
                <a href="https://m.me/105884602605306" target="_blank" rel="noreferrer">Contact</a>
                <a href="https://m.me/105884602605306" target="_blank" rel="noreferrer">Customer Support</a>
                <a href="/#start">Start Workspace</a>
                <a href="/upscale">Image Upscale</a>
              </div>
            </nav>
          </div>

          <div className="site-footer-bottom">
            <span>© DesaynClaw. All rights reserved 2024-2026</span>
          </div>
        </footer>
        </div>

      </main>



      {/* AI Guidelines Popup */}
      <AIDisclaimerModal />

      {/* ─── SEO: FAQ Structured Data (JSON-LD) ─────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "What is DesaynClaw?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "DesaynClaw is an AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K image upscaling. It's built specifically for print shops and apparel designers who need clean, print-ready files fast.",
                },
              },
              {
                "@type": "Question",
                "name": "How do I extract a flat sublimation design from a jersey mockup?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Simply upload your jersey mockup image to DesaynClaw, choose 'Flat Extract' mode, and our AI will automatically remove the 3D shirt shape, correct the perspective, and output a clean flat rectangular sublimation print file ready for production.",
                },
              },
              {
                "@type": "Question",
                "name": "Can DesaynClaw convert my logo to SVG vector?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Yes! DesaynClaw can auto-trace your PNG or JPG logo into a clean, scalable SVG vector file. It removes compression artifacts, enhances the design, and outputs a production-ready SVG you can open in Adobe Illustrator, CorelDRAW, or Inkscape.",
                },
              },
              {
                "@type": "Question",
                "name": "Does DesaynClaw support background removal for sublimation designs?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Yes. DesaynClaw has a built-in AI background remover that can cleanly cut out jersey designs, logos, and product photos to produce transparent PNG files — no Photoshop required.",
                },
              },
              {
                "@type": "Question",
                "name": "Can I upscale a low-resolution sublimation design?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Absolutely. DesaynClaw's AI upscaler can enhance any low-resolution sublimation design, jersey artwork, or logo to 4K quality — making it suitable for large format printing without quality loss.",
                },
              },
              {
                "@type": "Question",
                "name": "Is DesaynClaw free to use?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "DesaynClaw offers free credits on sign up so you can try all the tools. Additional credits can be purchased at an affordable rate, making it accessible for small print shops and solo designers.",
                },
              },
              {
                "@type": "Question",
                "name": "What file formats does DesaynClaw support?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "DesaynClaw accepts PNG and JPG image uploads. It outputs SVG vector files, 4K PNG images, and transparent PNG cutouts depending on the tool you use.",
                },
              },
            ],
          }),
        }}
      />
      {/* ─── SEO: HowTo Structured Data ─────────────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            "name": "How to Extract a Flat Sublimation Design from a Jersey Mockup",
            "description":
              "Use DesaynClaw's AI to extract a clean, flat sublimation print file from any jersey photo or mockup in minutes.",
            "totalTime": "PT2M",
            "tool": {
              "@type": "HowToTool",
              "name": "DesaynClaw AI Tracer",
            },
            "step": [
              {
                "@type": "HowToStep",
                "position": 1,
                "name": "Upload Your Jersey Image",
                "text": "Upload a photo or mockup of the jersey you want to extract. Supported formats: PNG, JPG.",
                "url": "https://desaynclaw.com",
              },
              {
                "@type": "HowToStep",
                "position": 2,
                "name": "Choose Flat Extract Mode",
                "text": "Select the 'Flat Extract' or 'Auto-Trace' option and let the AI remove the 3D shirt shape and correct perspective.",
                "url": "https://desaynclaw.com",
              },
              {
                "@type": "HowToStep",
                "position": 3,
                "name": "Review and Upscale",
                "text": "Review the AI-generated flat design and optionally upscale it to 4K for high-resolution sublimation printing.",
                "url": "https://desaynclaw.com",
              },
              {
                "@type": "HowToStep",
                "position": 4,
                "name": "Export as SVG or PNG",
                "text": "Download your clean, print-ready flat design as an SVG vector or 4K PNG file.",
                "url": "https://desaynclaw.com",
              },
            ],
          }),
        }}
      />
    </div>
  );
}
