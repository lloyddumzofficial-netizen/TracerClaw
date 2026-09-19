"""Compile a Photoshop garment mockup into browser-safe preview assets.

This is an offline developer tool. PSD files and psd-tools are never loaded by
the Next.js application or deployed to production.
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops
from psd_tools import PSDImage


TARGET_WIDTH = 1100

GARMENT_PROFILES = {
    "sports-tshirt": {
        "manifest_id": "sports-tshirt",
        "default_version": 3,
        "source": "desaynclaw-mockup-masters/mockup-studio/masters/sports-tshirt",
    },
    "polo-jersey": {
        "manifest_id": "polo-jersey",
        "default_version": 1,
        "source": "desaynclaw-mockup-masters/mockup-studio/masters/polo-jersey",
    },
}


def find_group(group, name):
    for layer in group:
        if layer.is_group() and layer.name == name:
            return layer
    raise ValueError(f"Missing Photoshop group: {name}")


def matching_layers(group, names):
    return [layer for layer in group if layer.name in names]


def find_layer(group, name):
    for layer in group:
        if layer.name == name:
            return layer
    raise ValueError(f"Missing Photoshop layer: {name}")


def layer_alpha_on_canvas(layer, canvas_size):
    rendered = layer.composite()
    if rendered is None:
        raise ValueError(f"Layer could not be rendered: {layer.name}")
    alpha = rendered.getchannel("A") if "A" in rendered.getbands() else Image.new("L", rendered.size, 255)
    canvas = Image.new("L", canvas_size, 0)
    canvas.paste(alpha, (layer.left, layer.top))
    return canvas


def combined_alpha(layers, canvas_size):
    mask = Image.new("L", canvas_size, 0)
    for layer in layers:
        mask = ImageChops.lighter(mask, layer_alpha_on_canvas(layer, canvas_size))
    return mask


def alpha_bbox(mask):
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("Generated mask is empty.")
    return bbox


def cuff_alpha(sleeve_mask, depth_ratio=0.13):
    """Derive a trim band that follows the true lower edge of a sleeve mask."""
    bbox = alpha_bbox(sleeve_mask)
    cropped = sleeve_mask.crop(bbox)
    source = cropped.load()
    result = Image.new("L", cropped.size, 0)
    target = result.load()
    depth = max(1, round(cropped.height * depth_ratio))
    for x in range(cropped.width):
        opaque_rows = [y for y in range(cropped.height) if source[x, y] > 8]
        if not opaque_rows:
            continue
        cutoff = max(0, opaque_rows[-1] - depth)
        for y in opaque_rows:
            if y >= cutoff:
                target[x, y] = source[x, y]
    canvas = Image.new("L", sleeve_mask.size, 0)
    canvas.paste(result, (bbox[0], bbox[1]))
    return canvas


def normalize_bbox(bbox, width, height):
    left, top, right, bottom = bbox
    return {
        "left": round(left / width * 100, 5),
        "top": round(top / height * 100, 5),
        "width": round((right - left) / width * 100, 5),
        "height": round((bottom - top) / height * 100, 5),
    }


def resolve_role_layers(psd, garment, view):
    if garment == "sports-tshirt":
        root = find_group(psd, "JERSEY")
        smart_group = find_group(root, "SMARTS")
        sleeve_layers = matching_layers(smart_group, {"SLEEVE DESIGN"})
        body_layers = matching_layers(smart_group, {"JERSEY DESIGN"})
        collar_layers = matching_layers(smart_group, {"COLLAR DESIGN", "INNER DESIGN", "TAPE DESIGN"})
        if len(sleeve_layers) != 2 or len(body_layers) != 1:
            raise ValueError("Unexpected Sports T-shirt Smart Object structure")

        # Wearer's left/right reverses in a front-facing view.
        sleeves_by_x = sorted(sleeve_layers, key=lambda layer: layer.left)
        if view == "front":
            role_layers = {
                "body": body_layers,
                "left_sleeve": [sleeves_by_x[1]],
                "right_sleeve": [sleeves_by_x[0]],
                "collar": collar_layers,
            }
        else:
            role_layers = {
                "body": body_layers,
                "left_sleeve": [sleeves_by_x[0]],
                "right_sleeve": [sleeves_by_x[1]],
                "collar": collar_layers,
            }
        return smart_group, role_layers, True

    root_name = "FRONT JERSEY" if view == "front" else "BACK JERSEY"
    group_name = "DESIGN HERE" if view == "front" else "BACK DESIGN"
    smart_group = find_group(find_group(psd, root_name), group_name)
    role_layers = {
        "body": [find_layer(smart_group, "FRONT" if view == "front" else "BACK")],
        "left_sleeve": [find_layer(smart_group, "LEFT SLEEVE")],
        "right_sleeve": [find_layer(smart_group, "RIGHT SLEEVE1")],
        "left_cuff": [find_layer(smart_group, "LEFT CUFF")],
        "right_cuff": [find_layer(smart_group, "RIGHT CUFF")],
    }
    if view == "front":
        role_layers["collar"] = [
            find_layer(smart_group, "COLLAR"),
            find_layer(smart_group, "COLLAR SKIP"),
            find_layer(smart_group, "NECKBAND"),
        ]
        role_layers["placket"] = [
            find_layer(smart_group, "FRONT PLACKED"),
            find_layer(smart_group, "BACK PLACKED"),
        ]
    else:
        role_layers["collar"] = [find_layer(smart_group, "COLLAR SKIP copy")]
    return smart_group, role_layers, False


def export_view(psd_path, garment, view, output_root, template_version):
    psd = PSDImage.open(psd_path)
    smart_group, role_layers, derive_cuffs = resolve_role_layers(psd, garment, view)
    smart_layers = list(smart_group)

    width, height = psd.width, psd.height
    scale = TARGET_WIDTH / width
    target_height = round(height * scale)
    output_dir = output_root / view
    mask_dir = output_dir / "masks"
    mask_dir.mkdir(parents=True, exist_ok=True)

    composite = psd.composite()
    composite.thumbnail((TARGET_WIDTH, target_height), Image.Resampling.LANCZOS)
    composite.save(output_dir / "base.webp", "WEBP", quality=90, method=6)

    role_masks = {role: combined_alpha(layers, (width, height)) for role, layers in role_layers.items()}
    if derive_cuffs:
        role_masks["left_cuff"] = cuff_alpha(role_masks["left_sleeve"])
        role_masks["right_cuff"] = cuff_alpha(role_masks["right_sleeve"])
    elif garment == "polo-jersey":
        # The source Polo masters contain narrow unassigned pixels at shoulder,
        # rear-neck and construction joins. Fill only those true coverage gaps
        # with the body artwork below every named Smart Object so the browser
        # preview never exposes the PSD's white placeholder fabric.
        garment_alpha = composite.getchannel("A")
        coverage = Image.new("L", (width, height), 0)
        for mask in role_masks.values():
            coverage = ImageChops.lighter(coverage, mask)
        body_bleed = ImageChops.subtract(garment_alpha, coverage)
        role_masks = {"body_bleed": body_bleed, **role_masks}

    parts = {}
    for role, mask in role_masks.items():
        bbox = alpha_bbox(mask)
        cropped = mask.crop(bbox)
        resized = cropped.resize(
            (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
            Image.Resampling.LANCZOS,
        )
        mask_name = f"{role.replace('_', '-')}.png"
        # CSS image masks use the PNG alpha channel by default. A grayscale-only
        # PNG is fully opaque to the browser and exposes the whole bounding box.
        alpha_mask = Image.new("RGBA", resized.size, (255, 255, 255, 0))
        alpha_mask.putalpha(resized)
        alpha_mask.save(mask_dir / mask_name, optimize=True)
        parts[role] = {
            **normalize_bbox(bbox, width, height),
            "mask": f"/mockup-studio/templates/v{template_version}/{garment}/{view}/masks/{mask_name}",
        }

    return {
        "canvas": {"width": width, "height": height, "aspectRatio": round(width / height, 8)},
        "base": f"/mockup-studio/templates/v{template_version}/{garment}/{view}/base.webp",
        "parts": parts,
        "smartObjectCount": sum(1 for layer in smart_layers if layer.kind == "smartobject"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--front", required=True, type=Path)
    parser.add_argument("--back", required=True, type=Path)
    parser.add_argument("--garment", choices=sorted(GARMENT_PROFILES), default="sports-tshirt")
    parser.add_argument("--version", type=int)
    parser.add_argument("--public-output", required=True, type=Path)
    parser.add_argument("--manifest-output", required=True, type=Path)
    args = parser.parse_args()
    profile = GARMENT_PROFILES[args.garment]
    template_version = args.version or profile["default_version"]

    manifest = {
        "id": profile["manifest_id"],
        "version": template_version,
        "source": profile["source"],
        "views": {
            "front": export_view(args.front, args.garment, "front", args.public_output, template_version),
            "back": export_view(args.back, args.garment, "back", args.public_output, template_version),
        },
    }
    args.manifest_output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    sys.exit(main())
