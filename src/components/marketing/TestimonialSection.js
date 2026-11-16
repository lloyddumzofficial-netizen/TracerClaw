"use client";

import { Quote, Star, ArrowUpRight } from "lucide-react";
import styles from "./TestimonialSection.module.css";

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


function ReviewCard({ review, featured = false }) {
  return (
    <article className={featured ? styles.featured : styles.card}>
      <Quote className={styles.quote} size={32} fill="currentColor" aria-hidden="true" />
      <blockquote>{review.feedback_text}</blockquote>
      <div className={styles.stars} aria-label={review.rating + " out of 5 stars"}>
        {Array.from({ length: 5 }, (_, index) => <Star key={index} size={13} fill={index < review.rating ? "currentColor" : "none"} aria-hidden="true" />)}
      </div>
      <footer className={styles.author}>
        <span className={styles.avatar} aria-hidden="true">{review.initials}</span>
        <div><strong>{review.reviewer_name}</strong><span>{review.reviewer_role}</span></div>
      </footer>
    </article>
  );
}

export default function TestimonialSection() {
  return (
    <section className={styles.section} aria-labelledby="testimonial-showcase-title">
      <div className={styles.top}>
        <header className={styles.heading}>
          <span className={styles.eyebrow}>Testimonials</span>
          <h2 id="testimonial-showcase-title">What creatives say.</h2>
          <p>From first upload to production handoff, a closer look at the DesaynClaw workflow.</p>
          <a href="#workspace-tools">Explore workspaces <ArrowUpRight size={15} aria-hidden="true" /></a>
          <small>Illustrative testimonials · Sample workflow feedback</small>
        </header>
        <ReviewCard review={SAMPLE_FEEDBACK[0]} featured />
      </div>
      <div className={styles.grid}>
        {SAMPLE_FEEDBACK.slice(1, 4).map(review => <ReviewCard key={review.reviewer_name} review={review} />)}
      </div>
    </section>
  );
}
