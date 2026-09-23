import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasAccess } from "@/server/access";
import { config } from "@/server/config";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { ConfirmProvider } from "@/components/providers/ConfirmProvider";
import { UploadProvider } from "@/components/providers/UploadProvider";
import { DialogsProvider } from "@/components/providers/DialogsProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Workspace } from "@/components/workspace/Workspace";
import { UploadTray } from "@/components/upload/UploadTray";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Server-side gate. Every API route used by the workspace checks the session again.
  if (!(await hasAccess())) redirect("/unlock");
  const limits = { maxImageBytes: config.maxImageBytes, maxVideoBytes: config.maxVideoBytes };
  return (
    <ToastProvider>
      <ConfirmProvider>
        <UploadProvider limits={limits}>
          <DialogsProvider>
            <Suspense>
              <AppShell>
                <Workspace limits={limits} />
              </AppShell>
            </Suspense>
            <UploadTray />
          </DialogsProvider>
        </UploadProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
