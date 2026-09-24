import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAccess, isConfigured } from "@/server/access";
import { BrandSymbol } from "@/components/Brand";
import { UnlockForm } from "./UnlockForm";

export const metadata: Metadata = { title: "Unlock" };
export const dynamic = "force-dynamic";

export default async function UnlockPage() {
  if (await hasAccess()) redirect("/");
  return (
    <main className="access">
      <div className="access-card">
        <div className="access-brand">
          <div className="access-particles" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => <span key={i} />)}
          </div>
          <div className="access-logo-shell">
            <BrandSymbol size={96} className="access-logo" priority />
          </div>
        </div>
        <h1 className="access-title">Your private media space.</h1>
        <p className="access-sub">Enter the workspace passphrase to upload and view images and videos.</p>
        <UnlockForm configured={isConfigured()} />
        <p className="access-note">Anyone with the passphrase can see, upload and delete the files in this workspace.</p>
      </div>
    </main>
  );
}
