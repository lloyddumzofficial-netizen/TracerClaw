"use client";

import { useEffect, useState } from "react";

const endpoint = "/api/local-login-artwork";
const rowCount = 6;
const publicSamples = ["flat-garment", "esports", "festival", "pattern", "polo", "upscale"]
  .map(name => `/marketing/login-artwork/${name}.webp`);
const sourceImages = process.env.NODE_ENV === "development"
  ? () => fetch(endpoint).then(response => response.ok ? response.json() : [])
    .then(images => Array.isArray(images) && images.length
      ? images.map(image => endpoint + "?image=" + encodeURIComponent(image))
      : publicSamples)
  : () => Promise.resolve(publicSamples);
let preparedImages = [];
let preparation;

export function preloadLoginArtwork() {
  if (preparation) return preparation;
  preparation = sourceImages()
    .then(async sources => {
      const decoded = await Promise.allSettled(sources.map(async src => {
        const thumbnail = new window.Image();
        thumbnail.src = src;
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

  const sources = images.length ? images.map(image => image.src) : publicSamples;

  return (
    <div className="login-artwork-grid">
      {Array.from({ length: rowCount }, (_, row) => {
        const tiles = sources.filter((_, index) => index % rowCount === row);
        const strip = tiles.length >= 6 ? tiles : Array.from({ length: 6 }, (_, index) =>
          tiles.length > 1 ? tiles[index % tiles.length] : sources[(row + index) % sources.length]);
        return (
          <div key={row} className="login-artwork-row">
            {[0, 1].map(copy => (
              <div key={copy} className="login-artwork-strip">
                {strip.map((image, index) => (
                  <img key={index} src={image}
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
