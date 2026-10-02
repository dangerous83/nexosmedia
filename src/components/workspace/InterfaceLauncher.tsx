"use client";

import { useRouter } from "next/navigation";
import { BrandSymbol, NexoTvSymbol, NexoTvWordmark, NexuflowLogo, Wordmark } from "@/components/Brand";
import { usePrefs, type BrandMode } from "@/lib/store";

export function InterfaceLauncher() {
  const router = useRouter();
  const [, setPrefs] = usePrefs();

  const enter = (brand: BrandMode) => {
    setPrefs({ brand });
    router.push("/?view=dashboard");
  };

  return (
    <main id="main" className="launcher" tabIndex={-1}>
      <header className="launcher-head">
        <h1>Choose your workspace</h1>
        <p>Each brand has its own separate media library.</p>
      </header>

      <div className="launcher-grid" role="group" aria-label="Available interfaces">
        <button className="launch-card launch-sphere" onClick={() => enter("nexosphere")}>
          <span className="launch-logo launch-logo-sphere">
            <BrandSymbol size={116} priority />
            <Wordmark height={16} />
          </span>
          <span className="launch-label"><strong>Enter Nexosphere</strong><span>Purple media workspace</span></span>
        </button>

        <button className="launch-card launch-flow" onClick={() => enter("nexuflow")}>
          <span className="launch-logo launch-logo-flow">
            <NexuflowLogo height={72} />
          </span>
          <span className="launch-label"><strong>Enter Nexuflow</strong><span>Blue media workspace</span></span>
        </button>

        <button className="launch-card launch-tv" onClick={() => enter("nexotv")}>
          <span className="launch-logo launch-logo-tv">
            <NexoTvSymbol size={116} />
            <NexoTvWordmark height={14} />
          </span>
          <span className="launch-label"><strong>Enter Nexo TV</strong><span>Gold media workspace</span></span>
        </button>
      </div>
    </main>
  );
}
