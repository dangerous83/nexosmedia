"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useReturnFocus } from "@/lib/focus";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  requirePassword?: boolean;
  passwordLabel?: string;
}

interface ConfirmResult { password?: string }
const Ctx = createContext<(o: ConfirmOptions) => Promise<ConfirmResult | null>>(async () => null);

/** Promise-based confirmation dialog, used for every destructive action. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [password, setPassword] = useState("");
  const resolver = useRef<(v: ConfirmResult | null) => void>(null);
  const returnFocus = useReturnFocus();

  const confirm = useCallback((o: ConfirmOptions) => {
    setPassword("");
    setOpts(o);
    return new Promise<ConfirmResult | null>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v ? { password: opts?.requirePassword ? password : undefined } : null);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog.Root open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" style={{ zIndex: 110 }} />
          <Dialog.Content className="dialog" role="alertdialog" style={{ zIndex: 111 }} onCloseAutoFocus={returnFocus}>
            {opts && (
              <>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  {opts.tone === "danger" && (
                    <span className="empty-icon" style={{ width: 40, height: 40, margin: 0, borderRadius: 12, color: "var(--danger)", flex: "none" }} aria-hidden>
                      <AlertTriangle style={{ width: 20, height: 20 }} />
                    </span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <Dialog.Title className="dialog-title">{opts.title}</Dialog.Title>
                    {opts.description ? (
                      <Dialog.Description asChild><div className="dialog-desc">{opts.description}</div></Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">Confirm this action</Dialog.Description>
                    )}
                  </div>
                </div>
                {opts.requirePassword && (
                  <label className="field confirm-password">
                    <span className="field-label">{opts.passwordLabel ?? "Password"}</span>
                    <input
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="off"
                      placeholder="Enter password to continue"
                    />
                  </label>
                )}
                <div className="dialog-actions">
                  <button className="btn btn-ghost" onClick={() => close(false)} autoFocus>
                    {opts.cancelLabel ?? "Cancel"}
                  </button>
                  <button className={`btn ${opts.tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)} disabled={opts.requirePassword && !password}>
                    {opts.confirmLabel ?? "Confirm"}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
