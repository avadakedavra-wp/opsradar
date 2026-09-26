"use client";

import { useEffect, useState } from "react";
import { listScans, Scan } from "@/lib/api";
import HistoryTimeline from "@/components/HistoryTimeline";
import Link from "next/link";
import {
  AlertCircle, ShieldCheck, ShieldAlert, Layers, Zap, ArrowRight,
} from "lucide-react";

// Severity legend shared across the whole page so colors are decodable.
export const SEVERITY = [
  { key: "critical" as const, label: "Critical", color: "#f85149", help: "fix now" },
  { key: "high" as const,     label: "High",     color: "#e3b341", help: "fix soon" },
  { key: "medium" as const,   label: "Medium",   color: "#d29922", help: "plan a fix" },
  { key: "low" as const,      label: "Low",      color: "#388bfd", help: "minor" },
];

export default function HistoryPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listScans()
      .then(setScans)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const chartScans  = scans.slice(0, 12).reverse();
  const maxFindings = Math.max(1, ...chartScans.map(s => s.critical + s.high + s.medium + s.low));
  const latest      = scans[0];
  const latestTotal = latest ? latest.critical + latest.high + latest.medium + latest.low : 0;
  const latestClear = latest && latestTotal === 0 && latest.status === "completed";

  return (
    <main className="overflow-y-auto h-full px-6 py-6 space-y-6 max-w-4xl">
      {/* Header — plain explanation of what this page is */}
      <div>
        <h1 className="text-lg font-semibold text-[#f0f6fc] tracking-tight">Scan History</h1>
        <p className="text-xs text-[#8b949e] mt-1 leading-relaxed max-w-2xl">
          Every time OpsRadar checks your cluster, the result is saved here.
          <span className="text-[#3fb950]"> Green</span> means healthy;
          <span className="text-[#f85149]"> red</span> means something needs attention.
          Click any scan to see the details and fixes.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md px-3 py-2.5">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-[#484f58] py-16 text-center">Loading history…</div>
      ) : scans.length === 0 ? (
        /* Friendly first-run empty state */
        <div className="flex flex-col items-center justify-center text-center gap-3 py-16 border border-dashed border-[#21262d] rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center">
            <ShieldCheck size={20} className="text-[#388bfd]" />
          </div>
          <div>
            <p className="text-sm text-[#f0f6fc] font-medium">No scans yet</p>
            <p className="text-xs text-[#8b949e] mt-1 max-w-xs">
              Run your first scan to check your cluster for security, reliability, and cost issues.
            </p>
          </div>
          <Link href="/" className="flex items-center gap-2 mt-1 text-xs font-semibold px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md transition-colors">
            <Zap size={12} /> Go to Dashboard to scan
          </Link>
        </div>
      ) : (
        <>
          {/* Summary cards — the "so what" at a glance */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Latest result */}
            <div className={`rounded-lg border p-4 ${
              latestClear
                ? "bg-[#3fb950]/8 border-[#3fb950]/25"
                : "bg-[#f85149]/8 border-[#f85149]/25"
            }`}>
              <div className="flex items-center gap-2">
                {latestClear
                  ? <ShieldCheck size={15} className="text-[#3fb950]" />
                  : <ShieldAlert size={15} className="text-[#f85149]" />}
                <span className="text-[10px] uppercase tracking-wider text-[#8b949e]">Latest scan</span>
              </div>
              <p className={`text-lg font-semibold mt-1.5 ${latestClear ? "text-[#3fb950]" : "text-[#f85149]"}`}>
                {latestClear ? "All clear" : `${latestTotal} issue${latestTotal !== 1 ? "s" : ""}`}
              </p>
              <p className="text-[11px] text-[#8b949e] mt-0.5">
                {latest.critical > 0 ? `${latest.critical} critical need attention` : "nothing critical"}
              </p>
            </div>

            {/* Total scans */}
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
              <div className="flex items-center gap-2">
                <Layers size={15} className="text-[#388bfd]" />
                <span className="text-[10px] uppercase tracking-wider text-[#8b949e]">Scans recorded</span>
              </div>
              <p className="text-lg font-semibold text-[#f0f6fc] mt-1.5">{scans.length}</p>
              <p className="text-[11px] text-[#8b949e] mt-0.5">across all clusters</p>
            </div>

            {/* Critical trend */}
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="text-[#e3b341]" />
                <span className="text-[10px] uppercase tracking-wider text-[#8b949e]">Critical issues</span>
              </div>
              <p className="text-lg font-semibold text-[#f0f6fc] mt-1.5">
                {scans.reduce((n, s) => n + s.critical, 0)}
              </p>
              <p className="text-[11px] text-[#8b949e] mt-0.5">found across history</p>
            </div>
          </div>

          {/* Severity legend — makes every color on the page decodable */}
          <div className="flex items-center gap-4 flex-wrap text-[11px] bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wider text-[#484f58]">What the colors mean</span>
            {SEVERITY.map(s => (
              <span key={s.key} className="flex items-center gap-1.5 text-[#8b949e]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[#e6edf3]">{s.label}</span>
                <span className="text-[#484f58]">— {s.help}</span>
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[#8b949e]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#3fb950" }} />
              <span className="text-[#e6edf3]">Healthy</span>
              <span className="text-[#484f58]">— no issues</span>
            </span>
          </div>

          {/* Trend chart */}
          {chartScans.length >= 2 && (
            <section className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold text-[#f0f6fc]">
                  Issues over time — last {chartScans.length} scans
                </h2>
                <span className="text-[10px] text-[#484f58]">shorter bars = healthier</span>
              </div>
              <div className="flex items-end gap-1.5 h-24">
                {chartScans.map(s => {
                  const total = s.critical + s.high + s.medium + s.low;
                  const pct = Math.round((total / maxFindings) * 100);
                  const color =
                    s.critical > 0 ? "#f85149"
                    : s.high > 0   ? "#e3b341"
                    : s.medium > 0 ? "#d29922"
                    : total > 0    ? "#388bfd"
                    : "#3fb950";
                  return (
                    <Link
                      key={s.id}
                      href={`/scan/${s.id}`}
                      className="flex-1 flex flex-col items-center gap-1 group"
                      title={`${new Date(s.started_at).toLocaleString()} — ${total} issue${total !== 1 ? "s" : ""}`}
                    >
                      <span className="text-[10px] font-mono" style={{ color }}>{total}</span>
                      <div
                        className="w-full rounded-sm group-hover:opacity-100 transition-opacity"
                        style={{ height: `${Math.max(4, pct)}%`, background: color, opacity: 0.75 }}
                      />
                    </Link>
                  );
                })}
              </div>
              <div className="flex gap-1.5 mt-2 border-t border-[#21262d] pt-2">
                {chartScans.map(s => (
                  <div key={s.id} className="flex-1 text-center text-[9px] text-[#484f58] font-mono truncate">
                    {new Date(s.started_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Timeline */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-[#f0f6fc]">All scans</h2>
              <span className="text-[10px] text-[#484f58]">newest first</span>
            </div>
            <HistoryTimeline scans={scans} />
          </section>
        </>
      )}
    </main>
  );
}
