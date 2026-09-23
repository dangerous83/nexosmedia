/* Official NEXOSPHERE artwork (derived without redrawing — see scripts/extract-brand-assets.mjs). */

export function BrandSymbol({ size = 32, className, priority }: { size?: number; className?: string; priority?: boolean }) {
  const src = size > 96 ? "/brand/nexosphere-symbol.png" : size > 48 ? "/brand/nexosphere-symbol-192.png" : "/brand/nexosphere-symbol-96.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="" aria-hidden className={className} decoding="async" fetchPriority={priority ? "high" : undefined} style={{ width: size, height: size, borderRadius: "50%" }} />
  );
}

/** The wordmark keeps its native 805:51 proportions. */
export function Wordmark({ height = 12, className }: { height?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/nexosphere-wordmark.png" alt="NEXOSPHERE" className={className} width={Math.round((height * 805) / 51)} height={height} style={{ height, width: "auto" }} />
  );
}
