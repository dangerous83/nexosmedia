"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";
interface ToastInput { title: string; description?: string; tone?: Tone; action?: { label: string; onClick: () => void }; duration?: number }
interface ToastItem extends ToastInput { id: number }

const Ctx = createContext<(t: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-1), { ...t, id }]); // at most two at once
    setTimeout(() => dismiss(id), t.duration ?? (t.tone === "error" ? 7000 : 4200));
  }, [dismiss]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        <div aria-live="polite" aria-atomic="false" style={{ display: "grid", gap: 8 }}>
          {items.map((t) => {
            const Icon = t.tone === "error" ? AlertCircle : t.tone === "info" ? Info : CheckCircle2;
            return (
              <div key={t.id} className={`toast toast-${t.tone ?? "success"}`} role={t.tone === "error" ? "alert" : "status"}>
                <Icon className="toast-icon" aria-hidden />
                <div className="toast-body">
                  <p className="toast-title">{t.title}</p>
                  {t.description && <p className="toast-desc">{t.description}</p>}
                  {t.action && (
                    <button className="btn btn-sm toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button className="icon-btn icon-btn-sm" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                  <X />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
