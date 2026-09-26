import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import { RootProvider } from "fumadocs-ui/provider/next";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: (
            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, fontSize: "0.875rem" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "1.5rem", height: "1.5rem", borderRadius: "0.375rem",
                background: "#6366f1", color: "#fff", fontSize: "0.625rem", fontWeight: 900,
              }}>
                OR
              </span>
              OpsRadar Docs
            </span>
          ),
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
