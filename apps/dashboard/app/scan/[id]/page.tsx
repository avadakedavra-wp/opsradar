"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listFindings, listScans, Finding, Scan } from "@/lib/api";
import ScanLogStream from "@/components/ScanLogStream";
import RecommendationCard from "@/components/RecommendationCard";

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) {
      listFindings(id).then(setFindings).catch(() => {});
      // listScans (not a single-scan endpoint, but this repo doesn't have
      // one yet) so this page can tell "genuinely clean" apart from "this
      // scan actually failed" instead of treating 0 findings as always good.
      listScans().then((scans) => setScan(scans.find((s) => s.id === id) ?? null)).catch(() => {});
    }
  }, [done, id]);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Live Scan Stream</h1>
        <p className="text-sm text-gray-500 mt-0.5 font-mono">scan id: {id}</p>
      </div>

      <ScanLogStream scanId={id} onDone={() => setDone(true)} />

      {done && findings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Findings ({findings.length})</h2>
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
        </section>
      )}

      {done && findings.length === 0 && scan?.status === "failed" && (
        <div className="text-center py-12 text-red-600 font-medium">
          ❌ Scan failed — {scan.failed_tasks}/{scan.total_tasks} task(s) errored.
          {scan.error_summary && <div className="text-sm text-red-400 font-normal mt-2 font-mono">{scan.error_summary}</div>}
        </div>
      )}

      {done && findings.length === 0 && scan?.status === "completed_with_errors" && (
        <div className="text-center py-12 text-amber-600 font-medium">
          ⚠️ Scan completed with errors — no findings, but {scan.failed_tasks}/{scan.total_tasks} task(s) failed to run.
        </div>
      )}

      {done && findings.length === 0 && (!scan || scan.status === "completed") && (
        <div className="text-center py-12 text-green-600 font-medium">
          ✅ Scan complete — no findings!
        </div>
      )}
    </main>
  );
}
