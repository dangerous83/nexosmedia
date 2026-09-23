"use client";

import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound } from "lucide-react";
import { CSRF_HEADERS } from "@/lib/api";

export function UnlockForm({ configured }: { configured: boolean }) {
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!configured) {
    return (
      <div className="access-setup" role="alert">
        <KeyRound aria-hidden />
        <div>
          <p className="access-setup-title">No passphrase has been set up yet</p>
          <p>
            On the server, run <code>npm run set-passphrase</code>, then restart the app. See the README for details.
          </p>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) {
      setError("Enter the workspace passphrase.");
      input.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't unlock the workspace. Please try again.");
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof TypeError ? "Can't reach the server. Check your connection and try again." : (err as Error).message);
      setBusy(false);
      setPassphrase("");
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  return (
    <form className="access-form" onSubmit={submit} noValidate>
      <label className="field-label" htmlFor="passphrase">Passphrase</label>
      <div className="password-field">
        <input
          ref={input}
          id="passphrase"
          className="input"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          autoFocus
          value={passphrase}
          onChange={(e) => { setPassphrase(e.target.value); if (error) setError(null); }}
          aria-invalid={!!error}
          aria-describedby={error ? "access-error" : undefined}
        />
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setShow(!show)} aria-label={show ? "Hide passphrase" : "Show passphrase"} aria-pressed={show}>
          {show ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {error && <p id="access-error" className="alert" role="alert"><AlertCircle aria-hidden />{error}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        Unlock workspace
        {!busy && <ArrowRight aria-hidden />}
      </button>
    </form>
  );
}
