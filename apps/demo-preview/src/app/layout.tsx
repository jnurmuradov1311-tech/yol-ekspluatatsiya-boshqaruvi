import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";
import {PwaRuntime} from "@/components/pwa-runtime";
import {ScriptProvider} from "@/components/script-provider";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp:{capable:true,title:"Yagona yo‘l",statusBarStyle:"default"},
  icons:{apple:"/mobile/apple-touch-icon.png"},
  other: { "codex-preview": "development" },
  title: { default: "RoadOps boshqaruv tizimi — Demo", template: "%s · RoadOps Demo" },
  description: "Avtomobil yo‘llarini ekspluatatsiya qilish va saqlash ishlarini boshqarish tizimi",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#06283e", viewportFit:"cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={inter.variable} lang="uz-Latn">
      <body><PwaRuntime/><ScriptProvider><AuthProvider>{children}</AuthProvider></ScriptProvider></body>
    </html>
  );
}
