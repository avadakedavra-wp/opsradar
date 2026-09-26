"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listFindings, listScans, Finding, Scan } from "@/lib/api";
import ScanLogStream from "@/components/ScanLogStream";
import RecommendationCard from "@/components/RecommendationCard";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) {
      listFindings(id).then(setFindings).catch(() => {});
      listScans()
        .then((scans) => setScan(scans.find((s) => s.id === id) ?? null))
        .catch(() => {});
    }
  }, [done, id]);

  return (
    <main className="px-6 py-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-[#f0f6fc] tracking-tight">Live Scan</h1>
        <p className="text-xs text-[#8b949e] mt-0.5 font-mono">{id}</p>
      </div>

      <ScanLogStream scanId={id} onDone={() => setDone(true)} />

      {done && findings.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[#f0f6fc] mb-3">
            Findings <span className="text-[#8b949e] font-normal">({findings.length})</span>
          </h2>
          <div className="space-y-2">
            {findings.map((f) => (
              <RecommendationCard
                key={f.id}
                finding={f}
                onResolved={(rid) =>
                  setFindings((prev) =>
                    prev.map((x) => x.id === rid ? { ...x, resolved_at: new Date().toISOString() } : x)
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {done && findings.length === 0 && scan?.status === "failed" && (
        <div className="flex items-center gap-3 py-6 px-4 bg-[#f85149]/8 border border-[#f85149]/20 rounded-lg">
          <XCircle size={18} className="text-[#f85149] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#f85149]">Scan failed</p>
            <p className="text-xs text-[#8b949e] mt-0.5">{scan.failed_tasks}/{scan.total_tasks} task(s) errored.</p>
            {scan.error_summary && (
              <p className="text-xs text-[#f85149]/70 mt-1 font-mono">{scan.error_summary}</p>
            )}
          </div>
        </div>
      )}

      {done && findings.length === 0 && scan?.status === "completed_with_errors" && (
        <div className="flex items-center gap-3 py-6 px-4 bg-[#e3b341]/8 border border-[#e3b341]/20 rounded-lg">
          <AlertTriangle size={18} className="text-[#e3b341] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#e3b341]">Completed with errors</p>
            <p className="text-xs text-[#8b949e] mt-0.5">
              No findings, but {scan.failed_tasks}/{scan.total_tasks} task(s) failed to run.
            </p>
          </div>
        </div>
      )}

      {done && findings.length === 0 && (!scan || scan.status === "completed") && (
        <div className="flex items-center gap-3 py-6 px-4 bg-[#3fb950]/8 border border-[#3fb950]/20 rounded-lg">
          <CheckCircle size={18} className="text-[#3fb950] shrink-0" />
          <p className="text-sm font-medium text-[#3fb950]">Scan complete — no findings.</p>
        </div>
      )}
    </main>
  );
}
