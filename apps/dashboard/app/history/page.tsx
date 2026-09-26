"use client";

import { useEffect, useState } from "react";
import { listScans, Scan } from "@/lib/api";
import HistoryTimeline from "@/components/HistoryTimeline";
import { AlertCircle } from "lucide-react";

export default function HistoryPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listScans().then(setScans).catch((e) => setError(String(e)));
  }, []);

  const chartScans = scans.slice(0, 10).reverse();
  const maxFindings = Math.max(1, ...chartScans.map((s) => s.critical + s.high + s.medium + s.low));

  return (
    <main className="overflow-y-auto h-full px-6 py-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-[#f0f6fc] tracking-tight">Scan History</h1>
        <p className="text-xs text-[#8b949e] mt-0.5">
          {scans.length} scan{scans.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md px-3 py-2.5">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      {/* Mini bar chart */}
      {chartScans.length >= 2 && (
        <section className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
          <h2 className="text-xs font-semibold text-[#f0f6fc] mb-4">
            Finding Trend — last {chartScans.length} scans
          </h2>
          <div className="flex items-end gap-1.5 h-24">
            {chartScans.map((s) => {
              const total = s.critical + s.high + s.medium + s.low;
              const pct = Math.round((total / maxFindings) * 100);
              const color =
                s.critical > 0 ? "#f85149"
                : s.high > 0   ? "#e3b341"
                : s.medium > 0 ? "#d29922"
                : "#3fb950";
              return (
                <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-mono" style={{ color }}>{total}</span>
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${Math.max(4, pct)}%`,
                      background: color,
                      opacity: 0.8,
                    }}
                    title={`${new Date(s.started_at).toLocaleDateString()}: ${total} findings`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 mt-2 border-t border-[#21262d] pt-2">
            {chartScans.map((s) => (
              <div key={s.id} className="flex-1 text-center text-[9px] text-[#484f58] font-mono truncate">
                {new Date(s.started_at).toLocaleDateString()}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs font-semibold text-[#f0f6fc] mb-4">Timeline</h2>
        <HistoryTimeline scans={scans} />
      </section>
    </main>
  );
}
