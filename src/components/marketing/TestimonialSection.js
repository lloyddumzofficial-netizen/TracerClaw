"use client";

import { BadgeCheck } from "lucide-react";

const SAMPLE_FEEDBACK = [
  {
    reviewer_name: "Renz",
    reviewer_role: "Print shop owner",
    rating: 5,
    feedback_text: "So many tracing tools out there, but I keep coming back to DesaynClaw. It just works for production files.",
    initials: "RP",
    tone: "gold",
  },
  {
    reviewer_name: "Mika",
    reviewer_role: "Jersey designer",
    rating: 5,
    feedback_text: "The interface feels clean and direct. I can upload artwork, review the result, and move faster without extra steps.",
    initials: "ML",
    tone: "slate",
  },
  {
    reviewer_name: "Jomar",
    reviewer_role: "Sublimation staff",
    rating: 5,
    feedback_text: "Ultra fast output for rush orders. The tools are simple enough for everyday print shop work.",
    initials: "JS",
    tone: "blue",
  },
  {
    reviewer_name: "Ana",
    reviewer_role: "Freelance layout artist",
    rating: 5,
    feedback_text: "DesaynClaw is the only design extraction tool I keep open beside my main editing apps.",
    initials: "AC",
    tone: "red",
  },
  {
    reviewer_name: "Mark",
    reviewer_role: "Small apparel brand",
    rating: 5,
    feedback_text: "It is crazy how much time it saves. I can test a new file and see a usable base almost immediately.",
    initials: "MD",
    tone: "violet",
  },
  {
    reviewer_name: "Lei",
    reviewer_role: "Production assistant",
    rating: 5,
    feedback_text: "Still the most useful AI creative tool in our production workflow.",
    initials: "LT",
    tone: "graphite",
  },
];

export default function TestimonialSection() {
  return (
    <section className="testimonial-showcase" aria-labelledby="testimonial-showcase-title">
      <div className="testimonial-heading">
        <h2 id="testimonial-showcase-title">Intuitive, powerful, and fast. See what others say about DesaynClaw.</h2>
        <p>Read our sample testimonials</p>
        <div className="testimonial-proof" aria-label="Sample feedback note">
          <span className="testimonial-proof-icon">
            <BadgeCheck size={14} />
          </span>
          <span>Sample workflow feedback</span>
        </div>
      </div>

      <div className="testimonial-grid">
        {SAMPLE_FEEDBACK.map((rev, idx) => (
          <article className="testimonial-card" key={`${rev.reviewer_name}-${idx}`}>
            <div className="testimonial-stars" aria-label={`${rev.rating} out of 5 stars`}>
              {Array.from({ length: 5 }).map((_, starIndex) => (
                <span className={starIndex < rev.rating ? "is-filled" : ""} key={starIndex}>
                  ★
                </span>
              ))}
            </div>

            <blockquote>"{rev.feedback_text}"</blockquote>

            <div className="testimonial-author">
              <span className={`testimonial-avatar tone-${rev.tone}`} aria-hidden="true">
                {rev.initials}
              </span>
              <div className="testimonial-author-copy">
                <strong>{rev.reviewer_name}</strong>
                <span>{rev.reviewer_role}</span>
              </div>
            </div>

          </article>
        ))}
      </div>
    </section>
  );
}
