"use client";

import { useEffect, useState } from "react";
import { listScans, listFindings, Scan, Finding } from "@/lib/api";
import RecommendationCard from "@/components/RecommendationCard";

export default function RecommendationsPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedScan, setSelectedScan] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listScans()
      .then((s) => {
        setScans(s);
        if (s.length > 0) setSelectedScan(s[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedScan) return;
    setLoading(true);
    listFindings(selectedScan)
      .then(setFindings)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedScan]);

  const critCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recommendations</h1>
          <p className="text-sm text-gray-500 mt-0.5">All findings for a scan, sorted by severity</p>
        </div>
        {scans.length > 0 && (
          <select
            value={selectedScan}
            onChange={(e) => setSelectedScan(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white"
          >
            {scans.map((s) => (
              <option key={s.id} value={s.id}>
                {s.cluster_name} — {new Date(s.started_at).toLocaleString()}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {findings.length > 0 && (
        <div className="flex gap-3 text-sm flex-wrap">
          <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full">{critCount} critical</span>
          <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full">{highCount} high</span>
          <span className="text-gray-500">{findings.length} total</span>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">Loading findings…</div>
      ) : findings.length === 0 ? (
        <div className="text-gray-400 text-sm">No findings for this scan.</div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <RecommendationCard
              key={f.id}
              finding={f}
              onResolved={(rid) =>
                setFindings((prev) => prev.map((x) => x.id === rid ? { ...x, resolved_at: new Date().toISOString() } : x))
              }
            />
          ))}
        </div>
      )}
    </main>
  );
}
