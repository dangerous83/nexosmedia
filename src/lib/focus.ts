"use client";

import { useCallback } from "react";

/*
 * Dialogs opened programmatically (not via <Dialog.Trigger>) have nowhere to return focus to,
 * so focus would fall back to <body>. We keep a short history of focused elements and, when a
 * dialog closes, return focus to the most recent one that is still on the page and outside it.
 * This also covers dialogs opened from a menu item: Radix focuses the menu trigger as the menu
 * closes, which lands in the history before the dialog takes focus.
 */
const history: HTMLElement[] = [];
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t !== document.body) {
      history.push(t);
      if (history.length > 30) history.shift();
    }
  }, true);
}

export function useReturnFocus(prefer?: () => HTMLElement | null) {
  return useCallback((e: Event) => {
    const container = e.target instanceof HTMLElement ? e.target : null;
    let target = prefer?.() ?? null;
    if (!target?.isConnected) {
      target = null;
      for (let i = history.length - 1; i >= 0; i--) {
        const el = history[i];
        if (el.isConnected && !container?.contains(el) && !el.closest('[role="menu"]')) { target = el; break; }
      }
    }
    if (target) {
      e.preventDefault();
      target.focus({ preventScroll: true });
    }
  }, [prefer]);
}
