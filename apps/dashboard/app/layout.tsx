import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavShell from "@/components/NavShell";
import { BobProvider } from "@/lib/bob-context";

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
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="h-full overflow-hidden bg-[#0d1117] text-[#f0f6fc] antialiased">
        <BobProvider>
          <NavShell>{children}</NavShell>
        </BobProvider>
      </body>
    </html>
  );
}
