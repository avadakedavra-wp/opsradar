import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import Nav from "@/components/Nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OpsRadar — Kubernetes Intelligence, AI-powered",
  description: "Scan every connected Kubernetes cluster, stream AI findings in real time, and generate commit-ready GitHub PRs. Local, free, open source.",
  keywords: ["Kubernetes", "k8s", "DevOps", "SRE", "IBM Bob", "AI", "cluster scanning"],
  openGraph: {
    title: "OpsRadar",
    description: "Kubernetes operations intelligence powered by IBM Bob Shell AI.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Providers>
          <Nav />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
