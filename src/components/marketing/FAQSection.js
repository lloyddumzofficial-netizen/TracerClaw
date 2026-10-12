"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import styles from "./FAQSection.module.css";

const FAQ_DATA = [
  {
    id: "what-is-desaynclaw",
    category: "general",
    q: "What is DesaynClaw?",
    a: "DesaynClaw is an AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K image upscaling. It's built specifically for print shops and apparel designers who need clean, print-ready files fast."
  },
  {
    id: "flat-sublimation-design",
    category: "artwork",
    q: "How do I extract a flat sublimation design from a jersey mockup?",
    a: "Simply upload your jersey mockup image, choose 'Flat Extract' mode, and our AI will automatically remove the 3D shirt shape, correct the perspective, and output a clean flat rectangular sublimation print file ready for production."
  },
  {
    id: "logo-to-svg",
    category: "artwork",
    q: "Can DesaynClaw convert my logo to SVG vector?",
    a: "Yes! DesaynClaw can auto-trace your PNG or JPG logo into a clean, scalable SVG vector file. It removes compression artifacts, enhances the design, and outputs a production-ready SVG you can open in Adobe Illustrator, CorelDRAW, or Inkscape."
  },
  {
    id: "background-removal",
    category: "artwork",
    q: "Does DesaynClaw support background removal?",
    a: "Yes. DesaynClaw has a built-in AI background remover that can cleanly cut out jersey designs, logos, and product photos to produce transparent PNG files — no Photoshop required."
  },
  {
    id: "image-upscale",
    category: "artwork",
    q: "Can I upscale a low-resolution sublimation design?",
    a: "Absolutely. DesaynClaw's AI upscaler can enhance any low-resolution sublimation design, jersey artwork, or logo to 4K quality — making it suitable for large format printing without quality loss."
  },
  {
    id: "pricing",
    category: "plans",
    q: "Is DesaynClaw free to use?",
    a: "No, DesaynClaw is a paid premium tool. We do not offer a free tier. However, our pricing is designed to be highly affordable for print shops and solo designers, giving you incredible value for the time you save."
  }
];

const FAQ_CATEGORIES = [
  { key: "all", label: "All questions" },
  { key: "general", label: "Getting started" },
  { key: "artwork", label: "Artwork tools" },
  { key: "plans", label: "Plans & access" }
];

export default function FAQSection() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [openId, setOpenId] = useState(null);

  const visibleFaqs = useMemo(
    () => FAQ_DATA.filter((faq) => activeCategory === "all" || faq.category === activeCategory),
    [activeCategory]
  );

  const selectCategory = (category) => {
    setActiveCategory(category);
    setOpenId(null);
  };

  return (
    <section id="faq" className={`${styles.section} faq-section`} aria-labelledby="faq-title">
      <header className={styles.header}>
        <p>Let&apos;s answer some questions</p>
        <h2 id="faq-title">Frequently Asked Questions</h2>

        <div className={styles.tabs} aria-label="FAQ categories">
          {FAQ_CATEGORIES.map((category) => (
            <button
              className={activeCategory === category.key ? styles.activeTab : undefined}
              type="button"
              key={category.key}
              aria-pressed={activeCategory === category.key}
              onClick={() => selectCategory(category.key)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.list}>
        {visibleFaqs.map((faq) => {
          const isOpen = openId === faq.id;
          return (
            <article className={`${styles.item}${isOpen ? ` ${styles.open}` : ""}`} key={faq.id}>
              <button
                className={styles.trigger}
                type="button"
                onClick={() => setOpenId(isOpen ? null : faq.id)}
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${faq.id}`}
              >
                <h3 id={`faq-question-${faq.id}`}>{faq.q}</h3>
                <span className={styles.icon} aria-hidden="true">
                  <Plus size={19} />
                </span>
              </button>

              <div
                id={`faq-answer-${faq.id}`}
                className={styles.answer}
                role="region"
                aria-labelledby={`faq-question-${faq.id}`}
                hidden={!isOpen}
              >
                <p>{faq.a}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}