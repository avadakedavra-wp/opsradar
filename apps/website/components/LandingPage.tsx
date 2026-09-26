"use client";

import { useLang } from "@/components/Providers";
import { translations } from "@/lib/i18n";

/* ── Severity badge ─────────────────────────────────────────── */
const SEV = {
  critical: { bg: "var(--sev-critical)", label: "CRITICAL" },
  high:     { bg: "var(--sev-high)",     label: "HIGH" },
  medium:   { bg: "var(--sev-medium)",   label: "MEDIUM" },
  low:      { bg: "var(--sev-low)",      label: "LOW" },
};
function Badge({ sev }: { sev: keyof typeof SEV }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold text-white"
      style={{ background: SEV[sev].bg }}
    >
      {SEV[sev].label}
    </span>
  );
}

/* ── Fake terminal ──────────────────────────────────────────── */
function Terminal() {
  const lines = [
    { t: 0,   c: "var(--text-muted)", txt: "$ opsradar scan" },
    { t: 100, c: "#60a5fa",           txt: "↳ loaded 3 kubeconfig contexts" },
    { t: 200, c: "var(--text-muted)", txt: "↳ scanning prod-cluster, staging, local…" },
    { t: 300, c: "#f472b6",           txt: "🔍 analysing prod/api-server (resource-audit)…" },
    { t: 400, c: "#f472b6",           txt: "🔍 analysing prod/worker (resource-audit)…" },
    { t: 500, c: "#facc15",           txt: "[high] prod/api-server — CPU over-provisioned (4000m req vs 12m actual)" },
    { t: 600, c: "#ef4444",           txt: "[critical] prod/worker — unpinned image nginx:latest" },
    { t: 700, c: "#facc15",           txt: "[high] prod/worker — missing liveness probe" },
    { t: 800, c: "#4ade80",           txt: "✅ GitHub repo detected: myorg/myapp → fetching source manifests" },
    { t: 900, c: "#4ade80",           txt: "✅ scan complete — 7 findings · 2 critical · 3 high" },
    { t: 1000,c: "#818cf8",           txt: "↳ opening PR: https://github.com/myorg/myapp/pull/42" },
  ];

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "#0d0d0f", borderColor: "var(--border)" }}
      role="img"
      aria-label="OpsRadar terminal demo"
    >
      {/* Traffic lights */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b" style={{ borderColor: "#1f1f27" }}>
        <span className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
        <span className="w-3 h-3 rounded-full bg-yellow-500 opacity-80" />
        <span className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
        <span className="ml-2 text-xs" style={{ color: "#555566" }}>OpsRadar — terminal</span>
      </div>
      <div className="p-5 space-y-1 font-mono text-xs leading-6 select-none">
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.c }}>{l.txt}</div>
        ))}
        <div style={{ color: "#818cf8" }}>█</div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function LandingPage() {
  const { lang } = useLang();
  const t = translations[lang];

  return (
    <>
      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 grid md:grid-cols-2 gap-12 items-center" id="product">
        <div className="space-y-6">
          <span
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full border"
            style={{ color: "var(--accent)", borderColor: "var(--accent)", background: "var(--accent-glow)" }}
          >
            {t.hero.eyebrow}
          </span>
          <h1
            className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight"
            style={{ color: "var(--text)" }}
          >
            {t.hero.headline.split("\n").map((line, i) => (
              <span key={i}>{i > 0 && <br />}{line}</span>
            ))}
          </h1>
          <p className="text-lg" style={{ color: "var(--text-muted)" }}>{t.hero.sub}</p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/docs"
              className="inline-flex items-center px-5 py-2.5 rounded-xl font-semibold text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--accent)" }}
            >
              {t.hero.cta}
            </a>
            <a
              href="#product"
              className="inline-flex items-center px-5 py-2.5 rounded-xl font-semibold text-sm border transition-colors"
              style={{ border: "1px solid var(--border)", color: "var(--text)" }}
            >
              {t.hero.demo} →
            </a>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t.hero.ctaSub}</p>
        </div>
        <div className="space-y-4">
          <Terminal />
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 py-20" id="features">
        <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--text)" }}>{t.features.title}</h2>
        <p className="mb-10" style={{ color: "var(--text-muted)" }}>{t.features.sub}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.features.items.map((f, i) => (
            <div
              key={i}
              className="rounded-2xl border p-5 space-y-2"
              style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
            >
              <span className="text-2xl" aria-hidden>{f.icon}</span>
              <h3 className="font-semibold text-sm" style={{ color: "var(--text)" }}>{f.title}</h3>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────── */}
      <section className="border-y py-20" style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}>
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-10" style={{ color: "var(--text)" }}>{t.howItWorks.title}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.howItWorks.steps.map((s, i) => (
              <div key={i} className="space-y-3">
                <div
                  className="text-3xl font-black tabular-nums"
                  style={{ color: "var(--accent)" }}
                >{s.n}</div>
                <h3 className="font-semibold" style={{ color: "var(--text)" }}>{s.title}</h3>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{s.body}</p>
                {i < t.howItWorks.steps.length - 1 && (
                  <div className="hidden lg:block absolute" aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SAMPLE FINDING ─────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--text)" }}>What a finding looks like</h2>
        <p className="mb-8" style={{ color: "var(--text-muted)" }}>Dense, accurate, and already pointing at the fix.</p>
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
        >
          {/* Finding header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <Badge sev="critical" />
            <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Unpinned image tag — nginx:latest</span>
          </div>
          <div className="px-5 py-4 grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Detail</p>
              <p className="text-sm" style={{ color: "var(--text)" }}>
                The container <code className="text-xs px-1 py-0.5 rounded" style={{ background:"var(--bg-subtle)", border:"1px solid var(--border)" }}>web</code> uses{" "}
                <code className="text-xs px-1 py-0.5 rounded" style={{ background:"var(--bg-subtle)", border:"1px solid var(--border)" }}>nginx:latest</code>.
                Unpinned tags cause non-deterministic deployments and can silently introduce breaking changes on re-pulls.
              </p>
              <p className="text-xs font-semibold uppercase tracking-wide mt-4" style={{ color: "var(--text-muted)" }}>Suggestion</p>
              <p className="text-sm" style={{ color: "var(--text)" }}>Pin to a specific digest, e.g. <code className="text-xs px-1 py-0.5 rounded" style={{ background:"var(--bg-subtle)", border:"1px solid var(--border)" }}>nginx:1.27.0</code>.</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>Diff patch</p>
              <div className="code-block text-xs">
{`--- a/deploy/deployment.yaml
+++ b/deploy/deployment.yaml
@@ -18,7 +18,7 @@
     spec:
       containers:
         - name: web
-          image: nginx:latest
+          image: nginx:1.27.0`}
              </div>
              <button
                className="mt-3 inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: "var(--accent)" }}
                onClick={() => alert("In the real app this opens a GitHub PR!")}
              >
                Generate PR →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer
        className="border-t py-10"
        style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}
      >
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold" style={{ color: "var(--text)" }}>
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-black text-white"
              style={{ background: "var(--accent)" }}
            >OR</span>
            OpsRadar
            <span className="text-xs font-normal ml-2" style={{ color: "var(--text-muted)" }}>{t.footer.tagline}</span>
          </div>
          <nav className="flex items-center gap-5 text-sm" style={{ color: "var(--text-muted)" }}>
            {t.footer.links.map(l => (
              <a key={l.label} href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="hover:text-[var(--accent)] transition-colors">
                {l.label}
              </a>
            ))}
          </nav>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t.footer.copy}</p>
        </div>
      </footer>
    </>
  );
}
