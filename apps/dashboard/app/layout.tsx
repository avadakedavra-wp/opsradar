import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpsRadar — Kubernetes Intelligence",
  description: "Kubernetes operations radar powered by Bob",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        <header className="border-b px-4 py-3 flex items-center gap-6 sticky top-0 bg-white z-10">
          <Link href="/" className="font-bold text-lg tracking-tight">
            OpsRadar
          </Link>
          <nav className="flex gap-4 text-sm text-gray-600">
            <Link href="/" className="hover:text-gray-900">Radar</Link>
            <Link href="/recommendations" className="hover:text-gray-900">Recommendations</Link>
            <Link href="/history" className="hover:text-gray-900">History</Link>
            <Link href="/docker" className="hover:text-gray-900">Docker</Link>
          </nav>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
