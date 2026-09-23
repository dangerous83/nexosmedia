import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/workspace.css";
import "@/styles/media.css";
import "@/styles/upload.css";
import "@/styles/access.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "NEXOSPHERE Media Space", template: "%s · NEXOSPHERE Media Space" },
  description: "A private Nexosphere workspace for uploading, browsing and viewing images and videos.",
  applicationName: "NEXOSPHERE Media Space",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
