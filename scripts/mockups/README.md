# Mockup master compiler

Large PSD masters live in the private `desaynclaw-mockup-masters` R2 bucket. They are developer inputs only and must never be committed or loaded by the Next.js runtime.

## R2 layout

```text
mockup-studio/masters/
  sports-tshirt/
    front.psd
    back.psd
  polo-jersey/
    POLO-FRONT.psd
    BACK-POLO.psd
    reference-polo.jpg
```

Download a master into the ignored `scratch/mockup-masters/<garment>/` directory, then compile it locally. The compiler exports a small WebP lighting/texture base, alpha masks for each mapped Smart Object, and a JSON manifest consumed by `TemplateGarmentPreview`.

## Compile Polo Jersey

```powershell
python scripts/mockups/extract_psd_template.py `
  --garment polo-jersey `
  --version 1 `
  --front scratch/mockup-masters/polo-jersey/POLO-FRONT.psd `
  --back scratch/mockup-masters/polo-jersey/BACK-POLO.psd `
  --public-output public/mockup-studio/templates/v1/polo-jersey `
  --manifest-output src/features/mockup-studio/templates/polo-jersey-v1.json
```

The Polo mapping expects the real master layer names: `FRONT`, `BACK`, `LEFT SLEEVE`, `RIGHT SLEEVE1`, `LEFT CUFF`, `RIGHT CUFF`, collar layers, and front/back placket layers. Compilation fails loudly if a required layer is renamed or missing.

Panel preparation dimensions are intentionally lower-resolution equivalents of each PSD Smart Object ratio. This keeps preview geometry stable while reducing browser memory, R2 storage, and AI reference-transfer cost.
