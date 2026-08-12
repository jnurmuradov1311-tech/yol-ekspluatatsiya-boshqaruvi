import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: "Yagona yo‘l", template: "%s · Yagona yo‘l" },
  description: "Avtomobil yo‘llarini ekspluatatsiya qilish va saqlash ishlarini boshqarish tizimi",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#073451" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={inter.variable} lang="uz-Latn">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
