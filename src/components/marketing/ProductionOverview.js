import Image from "next/image";
import { CheckIcon as Check, ChecksIcon as CheckCheck, ClockIcon as Clock3, CropIcon as Crop, DownloadIcon as Download, FileImageIcon as FileImage, FileCodeIcon as FileType2, FolderOpenIcon as FolderOpen, StackIcon as Layers3, PackageIcon as Package, ScanIcon as ScanLine, ShieldCheckIcon as ShieldCheck, SparkleIcon as Sparkles } from "@phosphor-icons/react/ssr";
import styles from "./ProductionOverview.module.css";

const steps = [[Crop, "Select your artwork"], [ScanLine, "Extract the design"], [Layers3, "Review the details"], [Download, "Export your files"]];
const files = [[FileType2, "Front artwork.svg", "Vector artwork"], [FileImage, "Back artwork.png", "Flat design"], [Package, "Production files.zip", "Export package"]];
// Decorative CC0 stock portraits, not customer photos or endorsements.
// Attribution and license records live beside the locally hosted assets.
const portraits = [2, 3, 4, 5, 6, 9, 11, 12, 13, 14, 4, 11, 5, 9];

export default function ProductionOverview() {
  return (
    <section className={styles.section} aria-labelledby="production-overview-heading">
      <header className={styles.heading}>
        <span>Built around your workflow</span>
        <h2 id="production-overview-heading">From the first upload to the final handoff.</h2>
        <p>A focused space for your artwork, your tools, and the files that come next.</p>
      </header>
      <div className={styles.grid}>
        <article className={`${styles.card} ${styles.community}`}>
          <div className={`${styles.visual} ${styles.communityVisual}`} aria-hidden="true">
            <div className={styles.orbit}>
              {Array.from({ length: 15 }, (_, i) => <span className={i === 7 ? styles.brand : styles.avatar} key={i}>{i === 7 ? <Image src="/Claws/Claws.webp" alt="" width={44} height={44} /> : <Image src={`/marketing/community/portrait-${portraits[i < 7 ? i : i - 1]}.webp`} alt="" width={54} height={54} />}</span>)}
            </div>
          </div>
          <div className={styles.copy}><h3>A workspace for people who make.</h3><p>For garment designers, logo artists, and print shops turning creative ideas into production artwork.</p></div>
        </article>
        <article className={`${styles.card} ${styles.workflow}`}>
          <div className={`${styles.visual} ${styles.workflowVisual}`} aria-hidden="true">
            <div className={styles.backSheet} />
            <div className={styles.stepSheet}><div className={styles.sheetTitle}><FolderOpen size={14} /> Garment artwork <span>Workflow</span></div>{steps.map(([Icon, label], i) => <div className={styles.step} key={label}><Icon size={15} /><span>{label}</span>{i < 3 ? <Check size={13} /> : <span className={styles.dot} />}</div>)}</div>
          </div>
          <div className={styles.copy}><h3>One clear path from source to export.</h3><p>Crop what matters, extract flat artwork, refine the result, and prepare your files for the next step.</p></div>
        </article>
        <article className={`${styles.card} ${styles.controls}`}>
          <div className={`${styles.visual} ${styles.controlsVisual}`} aria-hidden="true">
            <div className={styles.wideSetting}><span><ShieldCheck size={16} /><strong>Your artwork stays yours</strong></span><CheckCheck size={16} /></div>
            <div className={styles.settingsGrid}>
              <div className={styles.settingsList}><div><Clock3 size={15} /><span>3-day file retention</span></div><div><Crop size={15} /><span>Guided artwork selection</span></div><div><Layers3 size={15} /><span>Standard & Precision SVG</span></div></div>
              <div className={styles.artworkSheet}><Sparkles size={18} /><strong>Ready for refinement.</strong><p>Your design.<br />Your finishing touches.</p><div className={styles.swatches}><i /><i /><i /><i /></div></div>
            </div>
          </div>
          <div className={styles.copy}><h3>The details stay in your hands.</h3><p>Choose your SVG mode, compare the output, and keep control of the artwork before you download.</p></div>
        </article>
        <article className={`${styles.card} ${styles.files}`}>
          <div className={`${styles.visual} ${styles.filesVisual}`} aria-hidden="true">
            <div className={styles.fileSheet}><div className={styles.fileHeader}><FolderOpen size={15} /> Project files <span>Sample</span></div>{files.map(([Icon, name, detail]) => <div className={styles.fileRow} key={name}><Icon size={16} /><div><strong>{name}</strong><small>{detail}</small></div><Download size={13} /></div>)}<span className={styles.exportLabel}>Prepared for your next step <Check size={12} /></span></div>
          </div>
          <div className={styles.copy}><h3>A cleaner production handoff.</h3><p>Download your finished artwork and export packages for your design and print workflow.</p></div>
        </article>
      </div>
    </section>
  );
}
