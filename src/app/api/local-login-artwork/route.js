import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const directory = path.join(process.cwd(), "public", "FLAT_deisgn-gallery");
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return new Response(null, { status: 404, headers });
  }

  const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const images = files.filter(file => file.isFile() && /\.png$/i.test(file.name))
    .map(file => file.name).sort();
  const image = url.searchParams.get("image");
  if (image === null) return Response.json(images, { headers });
  if (!images.includes(image)) return new Response(null, { status: 404, headers });

  try {
    const thumbnail = await sharp(path.join(directory, image))
      .rotate().resize(224, 256, { fit: "cover" }).webp({ quality: 69 }).toBuffer();
    return new Response(thumbnail, { headers: { "Cache-Control": "private, max-age=300", "Content-Type": "image/webp" } });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
