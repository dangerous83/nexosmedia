"use client";

import { useState } from "react";
import { Film, ImageOff } from "lucide-react";
import { mediaUrl } from "@/lib/api";
import type { Media } from "@/lib/types";

/**
 * Lazy thumbnail inside a fixed 4:3 frame (never the original file).
 * Landscape and square media fill the frame; portrait and very wide media are shown whole,
 * over a soft blurred copy of themselves, so nothing important is cropped away.
 */
export function MediaThumb({ media, eager }: { media: Pick<Media, "id" | "kind" | "hasThumb" | "width" | "height">; eager?: boolean }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  if (!media.hasThumb || state === "error") {
    const Icon = media.kind === "video" ? Film : ImageOff;
    return (
      <span className="thumb-fallback" aria-hidden>
        <Icon />
        <span>{media.hasThumb ? "Preview unavailable" : media.kind === "video" ? "No preview frame" : "No preview"}</span>
      </span>
    );
  }
  const ratio = media.width && media.height ? media.width / media.height : 4 / 3;
  const contain = ratio < 0.95 || ratio > 1.95;
  const src = mediaUrl.thumb(media);
  return (
    <>
      {contain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" aria-hidden className="thumb-backdrop" loading={eager ? "eager" : "lazy"} decoding="async" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`thumb-img${contain ? " is-contain" : ""}`}
        data-loaded={state === "loaded" || undefined}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
      />
    </>
  );
}
