"use client";

import { ArrowRight, Film, Orbit, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { BrandSymbol, NexuflowLogo, Wordmark } from "@/components/Brand";
import { usePrefs, type BrandMode } from "@/lib/store";

export function InterfaceLauncher() {
  const router = useRouter();
  const [, setPrefs] = usePrefs();

  const enter = (brand: BrandMode) => {
    setPrefs({ brand });
    router.push("/?view=all");
  };

  return (
    <main id="main" className="launcher" tabIndex={-1}>
      <div className="launcher-aurora launcher-aurora-purple" aria-hidden />
      <div className="launcher-aurora launcher-aurora-blue" aria-hidden />
      <header className="launcher-head">
        <span className="launcher-kicker"><Sparkles aria-hidden /> Nexos Media Space</span>
        <h1>Choose your interface</h1>
        <p>Enter the workspace that matches the brand you&rsquo;re creating for.</p>
      </header>

      <div className="launcher-grid" role="group" aria-label="Available interfaces">
        <button className="launch-card launch-sphere" onClick={() => enter("nexosphere")}>
          <span className="launch-noise" aria-hidden />
          <span className="launch-orbits" aria-hidden><i /><i /><i /></span>
          <span className="launch-logo launch-logo-sphere">
            <BrandSymbol size={116} priority />
            <Wordmark height={16} />
          </span>
          <span className="launch-copy">
            <span className="launch-eyebrow"><Film aria-hidden /> Video &amp; media workspace</span>
            <strong>Enter Nexosphere</strong>
            <span>Purple energy, cinematic focus, full media library.</span>
          </span>
          <span className="launch-action">Open interface <ArrowRight aria-hidden /></span>
        </button>

        <button className="launch-card launch-flow" onClick={() => enter("nexuflow")}>
          <span className="launch-noise" aria-hidden />
          <span className="launch-flow-lines" aria-hidden><i /><i /><i /></span>
          <span className="launch-logo launch-logo-flow">
            <span className="launch-flow-mark"><Orbit aria-hidden /></span>
            <NexuflowLogo height={72} />
          </span>
          <span className="launch-copy">
            <span className="launch-eyebrow"><Film aria-hidden /> Video &amp; media workspace</span>
            <strong>Enter Nexuflow</strong>
            <span>Black canvas, white clarity, electric blue momentum.</span>
          </span>
          <span className="launch-action">Open interface <ArrowRight aria-hidden /></span>
        </button>
      </div>

      <p className="launcher-foot">Your files stay together. You can switch interfaces again from the sidebar.</p>
    </main>
  );
}
