"use client";

import { createContext, Suspense, useContext, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useReturnFocus } from "@/lib/focus";
import { usePrefs } from "@/lib/store";
import { Sidebar } from "./Sidebar";

/*
 * Layout: sidebar (≥1100px, collapsible to a rail) · icon rail (768–1099px) · drawer (<768px).
 * Visibility of navigation is never authorization: every route checks the session server-side.
 */

const DrawerCtx = createContext<() => void>(() => {});
export const useOpenDrawer = () => useContext(DrawerCtx);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = usePrefs();
  const [drawer, setDrawer] = useState(false);
  const returnFocus = useReturnFocus();
  const params = useSearchParams();
  useEffect(() => setDrawer(false), [params]);

  return (
    <DrawerCtx.Provider value={() => setDrawer(true)}>
      <div className="app" data-rail={prefs.sidebarCollapsed || undefined}>
        <a href="#main" className="skip-link">Skip to media</a>
        <aside className="app-side" aria-label="Sidebar">
          <Suspense><Sidebar rail={prefs.sidebarCollapsed} canToggle onToggleRail={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })} /></Suspense>
        </aside>
        <aside className="app-rail" aria-label="Sidebar">
          <Suspense><Sidebar rail /></Suspense>
        </aside>
        <div className="app-main">{children}</div>

        <Dialog.Root open={drawer} onOpenChange={setDrawer}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="drawer" aria-describedby={undefined} onCloseAutoFocus={returnFocus}>
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
              <Dialog.Close asChild><button className="icon-btn drawer-close" aria-label="Close navigation"><X /></button></Dialog.Close>
              <Suspense><Sidebar onNavigate={() => setDrawer(false)} /></Suspense>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </DrawerCtx.Provider>
  );
}
