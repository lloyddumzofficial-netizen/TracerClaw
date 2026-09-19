import sportsTshirtTemplate from "../templates/sports-tshirt-v1.json";
import poloJerseyTemplate from "../templates/polo-jersey-v1.json";
import styles from "./templateGarmentPreview.module.css";

const TEMPLATE_REGISTRY = Object.freeze({
  sports_tshirt: sportsTshirtTemplate,
  polo_jersey: poloJerseyTemplate,
});

const TEMPLATE_LABELS = Object.freeze({
  sports_tshirt: "Sports T-shirt",
  polo_jersey: "Polo Jersey",
});

const VIEW_ASSET_ROLES = Object.freeze({
  front: { body_bleed: "front", body: "front", left_sleeve: "left_sleeve", right_sleeve: "right_sleeve", collar: "collar", placket: "placket", left_cuff: "left_cuff", right_cuff: "right_cuff" },
  back: { body_bleed: "back", body: "back", left_sleeve: "left_sleeve", right_sleeve: "right_sleeve", collar: "collar", left_cuff: "left_cuff", right_cuff: "right_cuff" },
});

function getPartColor(role, colors) {
  if (role === "collar") return colors.collar;
  if (role === "placket") return colors.placket;
  if (role === "left_cuff") return colors.leftCuff;
  if (role === "right_cuff") return colors.rightCuff;
  return "#FFFFFF";
}

function TemplatePart({ part, role, asset, color, colorLocked }) {
  const position = {
    left: `${part.left}%`,
    top: `${part.top}%`,
    width: `${part.width}%`,
    height: `${part.height}%`,
    backgroundColor: color,
    WebkitMaskImage: `url(${part.mask})`,
    maskImage: `url(${part.mask})`,
  };

  return (
    <span className={styles.templatePart} style={position} data-part={role}>
      {asset && !colorLocked ? <img src={asset.file_url} alt="" draggable="false" /> : null}
    </span>
  );
}

function TemplateView({ label, garmentType, garmentLabel, view, template, assets, colors }) {
  const roleMap = VIEW_ASSET_ROLES[view];
  return (
    <article className={styles.templateView}>
      <div className={styles.viewLabel}><span>{label}</span><small>{assets[roleMap.body] ? "Artwork applied" : "Waiting for artwork"}</small></div>
      <div className={styles.templateCanvas} style={{ aspectRatio: template.canvas.aspectRatio }}>
        {Object.entries(template.parts).map(([role, part]) => (
          <TemplatePart
            key={role}
            part={part}
            role={role}
            asset={assets[roleMap[role]]}
            color={getPartColor(role, colors)}
            colorLocked={garmentType === "polo_jersey" && ["collar", "placket", "left_cuff", "right_cuff"].includes(role)}
          />
        ))}
        <img className={styles.templateBase} src={template.base} alt={`${label} ${garmentLabel} preview`} draggable="false" />
      </div>
    </article>
  );
}

export function hasGarmentTemplate(garmentType) {
  return Boolean(TEMPLATE_REGISTRY[garmentType]);
}

export default function TemplateGarmentPreview({ garmentType, assets, colors }) {
  const template = TEMPLATE_REGISTRY[garmentType];
  if (!template) return null;
  const garmentLabel = TEMPLATE_LABELS[garmentType];

  return (
    <div className={styles.previewShell} style={{ "--preview-backdrop": colors.backdrop }}>
      <div className={styles.previewGrid}>
        <TemplateView label="Front" garmentType={garmentType} garmentLabel={garmentLabel} view="front" template={template.views.front} assets={assets} colors={colors} />
        <TemplateView label="Back" garmentType={garmentType} garmentLabel={garmentLabel} view="back" template={template.views.back} assets={assets} colors={colors} />
      </div>
      <div className={styles.previewFooter}>
        <span>PSD-derived live preview</span>
        <span>{garmentLabel} · Template v{template.version}</span>
      </div>
    </div>
  );
}
