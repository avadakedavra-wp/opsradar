"use client";

import { useEffect, useState } from "react";
import { listScans, Scan } from "@/lib/api";
import HistoryTimeline from "@/components/HistoryTimeline";

export default function HistoryPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listScans().then(setScans).catch((e) => setError(String(e)));
  }, []);

  // Build chart data: total findings per scan (last 10)
  const chartScans = scans.slice(0, 10).reverse();
  const maxFindings = Math.max(1, ...chartScans.map((s) => s.critical + s.high + s.medium + s.low));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scan History</h1>
        <p className="text-sm text-gray-500 mt-0.5">{scans.length} scan{scans.length !== 1 ? "s" : ""} recorded</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {/* Mini bar chart */}
      {chartScans.length >= 2 && (
        <section>
          <h2 className="text-base font-semibold mb-3">Finding Trend (last {chartScans.length} scans)</h2>
          <div className="flex items-end gap-2 h-32 border-b pb-1">
            {chartScans.map((s) => {
              const total = s.critical + s.high + s.medium + s.low;
              const pct = Math.round((total / maxFindings) * 100);
              const color = s.critical > 0 ? "bg-red-500" : s.high > 0 ? "bg-orange-400" : s.medium > 0 ? "bg-yellow-400" : "bg-green-400";
              return (
                <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{total}</span>
                  <div
                    className={`w-full rounded-t ${color}`}
                    style={{ height: `${Math.max(4, pct)}%` }}
                    title={`${new Date(s.started_at).toLocaleDateString()}: ${total} findings`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-1">
            {chartScans.map((s) => (
              <div key={s.id} className="flex-1 text-center text-xs text-gray-400 truncate">
                {new Date(s.started_at).toLocaleDateString()}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      <section>
        <h2 className="text-base font-semibold mb-4">Timeline</h2>
        <HistoryTimeline scans={scans} />
      </section>
    </main>
  );
}
