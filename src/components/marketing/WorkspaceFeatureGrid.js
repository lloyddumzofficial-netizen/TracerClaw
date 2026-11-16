import Image from "next/image";
import svgModesImage from "../../../public/FEATURES/SVG MODES.png";
import styles from "./WorkspaceFeatureGrid.module.css";

const features = [
  { image: "/FEATURES/CLEAN EXTRACTED AI DESIGN TO FLAT EDITABLE.png", title: "From mockup to editable artwork", description: "Extract flat artwork from garment mockups, compare the result, and download your finished SVG or project ZIP.", alt: "DesaynClaw artwork review showing an extracted festival design and SVG and ZIP download controls" },
  { image: "/FEATURES/LOGO WORKSPACE.png", title: "Bring your logo into focus", description: "Compare your source with the vector result and adjust trace settings to refine your logo before export.", alt: "Lion logo comparison beside color detail and SVG trace settings in the logo workspace" },
  { image: "/FEATURES/CROP CORRECTLY.png", title: "A better result starts with the crop", description: "Keep the complete logo inside your selection. Built-in examples help you leave extra background and empty space behind.", alt: "Logo crop workspace with a lion artwork and correct and wrong crop examples" },
  { image: svgModesImage, title: "Choose the detail your artwork needs", description: "Use Standard SVG for everyday artwork or Precision SVG when your logo needs tighter paths and finer detail.", alt: "Standard SVG and Precision SVG options in the DesaynClaw trace settings" },
];

export default function WorkspaceFeatureGrid() {
  return (
    <section className={styles.section} aria-labelledby="workspace-features-heading">
      <header className={styles.header}>
        <span>Inside DesaynClaw</span>
        <h2 id="workspace-features-heading">Small details. Production-ready results.</h2>
        <p>A closer look at the tools behind your finished artwork.</p>
      </header>
      <div className={styles.grid}>
        {features.map(feature => (
          <article className={styles.card} key={feature.title}>
            <div className={styles.preview}>
              <Image src={feature.image} alt={feature.alt} width={700} height={460} sizes="(max-width: 640px) 90vw, (max-width: 1200px) 45vw, 520px" />
            </div>
            <div className={styles.copy}>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
