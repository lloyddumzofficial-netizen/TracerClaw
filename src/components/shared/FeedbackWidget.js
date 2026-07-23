"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import styles from "./FeedbackWidget.module.css";

const REVIEWED_PROJECT_PREFIX = "desaynclaw:reviewed-project:";

function getReviewedProjectKey(projectId) {
  return projectId ? `${REVIEWED_PROJECT_PREFIX}${projectId}` : null;
}

function hasStoredReview(projectId) {
  const key = getReviewedProjectKey(projectId);
  if (!key || typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "1";
}

export default function FeedbackWidget({ projectId, initialRating = null }) {
  const hideTimerRef = useRef(null);
  const reviewedStorageKey = useMemo(() => getReviewedProjectKey(projectId), [projectId]);
  const hasExistingReview = Boolean(initialRating) || hasStoredReview(projectId);
  const [rating, setRating] = useState(initialRating || 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isHidden, setIsHidden] = useState(hasExistingReview);
  const [feedbackText, setFeedbackText] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const shouldHide = Boolean(initialRating) || hasStoredReview(projectId);
    setRating(initialRating || 0);
    setHoverRating(0);
    setFeedbackText("");
    setSubmitted(false);
    setIsHidden(shouldHide);
    setIsExpanded(false);
  }, [initialRating, projectId]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleSubmit = async () => {
    if (!projectId || rating === 0 || submitted) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, feedback_text: feedbackText }),
      });
      if (!res.ok) throw new Error("API returned error");
      if (reviewedStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(reviewedStorageKey, "1");
      }
      setSubmitted(true);
      hideTimerRef.current = window.setTimeout(() => setIsHidden(true), 1600);
    } catch (err) {
      console.error("Failed to save rating:", err);
      alert("Failed to save review! Have you run the SQL migration?");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!projectId || isHidden) return null;

  if (submitted) {
    return (
      <div className={styles.feedbackContainer}>
        <div className={styles.successMessage}>
          <span style={{ color: "#4ade80", fontSize: "18px" }}>✓</span> Thank you for your feedback!
        </div>
      </div>
    );
  }

  const selectRating = (value) => {
    setRating(value);
    setIsExpanded(true);
  };

  return (
    <div className={`${styles.feedbackContainer} ${isExpanded ? styles.expanded : styles.compact}`}>
      <div className={styles.headerRow}>
        <div>
          <h3 className={styles.title}>Rate this generation</h3>
          <p className={styles.subtitle}>
            {isExpanded ? "Optional note helps improve output quality." : "One quick rating after export."}
          </p>
        </div>
        {!isExpanded && (
          <button type="button" className={styles.expandBtn} onClick={() => setIsExpanded(true)}>
            Review
          </button>
        )}
      </div>

      <div className={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            className={styles.starBtn}
            onMouseEnter={() => setHoverRating(value)}
            onMouseLeave={() => setHoverRating(0)}
            onClick={() => selectRating(value)}
            disabled={isSubmitting}
            title={`${value} Star${value > 1 ? "s" : ""}`}
          >
            <Star
              size={isExpanded ? 24 : 20}
              fill={(hoverRating || rating) >= value ? "#fbbf24" : "transparent"}
              color={(hoverRating || rating) >= value ? "#fbbf24" : "#555"}
              strokeWidth={1.5}
              style={{ transition: "all 0.2s ease" }}
            />
          </button>
        ))}
      </div>

      {isExpanded && (
        <div className={styles.optionalFeedback}>
          <textarea
            placeholder="Tell us what you liked or how we can improve... (Optional)"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            disabled={isSubmitting}
          />
          <div className={styles.footerRow}>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className={styles.minimizeBtn}
              disabled={isSubmitting}
            >
              Minimize
            </button>
            <button
              onClick={handleSubmit}
              disabled={rating === 0 || isSubmitting}
              className={styles.submitBtn}
            >
              {isSubmitting ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
