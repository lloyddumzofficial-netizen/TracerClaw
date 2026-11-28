"use client";

import { useEffect, useState } from "react";

const endpoint = "/api/local-login-artwork";
const rowCount = 6;
let preparedImages = [];
let preparation;

export function preloadLoginArtwork() {
  if (preparation) return preparation;
  preparation = fetch(endpoint)
    .then(response => response.ok ? response.json() : [])
    .then(async images => {
      if (!Array.isArray(images)) return [];
      const decoded = await Promise.allSettled(images.map(async image => {
        const thumbnail = new window.Image();
        thumbnail.src = endpoint + "?image=" + encodeURIComponent(image);
        await thumbnail.decode();
        return thumbnail;
      }));
      preparedImages = decoded.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      return preparedImages;
    })
    .catch(() => [])
    .then(images => {
      if (!images.length) preparation = undefined;
      return images;
    });
  return preparation;
}

export default function LocalLoginArtwork() {
  const [images, setImages] = useState(() => preparedImages);

  useEffect(() => {
    let active = true;
    preloadLoginArtwork().then(result => {
      if (active) setImages(result);
    });
    return () => { active = false; };
  }, []);

  if (!images.length) return null;

  return (
    <div className="login-artwork-grid">
      {Array.from({ length: rowCount }, (_, row) => {
        const tiles = images.filter((_, index) => index % rowCount === row);
        const strip = tiles.length >= 6 ? tiles : Array.from({ length: 6 }, (_, index) =>
          (tiles.length ? tiles : images)[index % (tiles.length || images.length)]);
        return (
          <div key={row} className="login-artwork-row">
            {[0, 1].map(copy => (
              <div key={copy} className="login-artwork-strip">
                {strip.map((image, index) => (
                  // This local endpoint already returns size-limited WebP thumbnails.
                  <img key={index} src={image.src}
                    width={112} height={128} alt="" decoding="async" />
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
