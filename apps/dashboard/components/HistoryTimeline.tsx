"use client";

import { Scan, scanStatusMeta } from "@/lib/api";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface Props {
  scans: Scan[];
}

function dotColor(scan: Scan): string {
  if (scan.critical > 0) return "#f85149";
  if (scan.high > 0)     return "#e3b341";
  if (scan.medium > 0)   return "#d29922";
  if (scan.low > 0)      return "#388bfd";
  return "#3fb950";
}

export default function HistoryTimeline({ scans }: Props) {
  if (scans.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[#8b949e] text-xs border border-dashed border-[#21262d] rounded-lg">
        No scan history yet.
      </div>
    );
  }

  return (
    <div className="relative pl-5 border-l border-[#21262d] flex flex-col gap-5">
      {scans.map((scan) => {
        const total = scan.critical + scan.high + scan.medium + scan.low;
        const statusMeta = scanStatusMeta(scan.status);
        const color = dotColor(scan);
        return (
          <div key={scan.id} className="relative">
            {/* Timeline dot */}
            <span
              className="absolute -left-[1.4rem] top-1.5 w-3 h-3 rounded-full border-2 border-[#0d1117]"
              style={{ background: color }}
            />
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm text-[#f0f6fc] font-medium">
                  {scan.cluster_name}
                  <span className="text-[#8b949e] font-normal ml-2 text-xs">
                    {new Date(scan.started_at).toLocaleString()}
                  </span>
                </p>
                <p className="text-xs text-[#8b949e] mt-0.5" title={scan.error_summary}>
                  <span className={`font-medium ${statusMeta.textClass}`}>{statusMeta.label}</span>
                  {scan.failed_tasks > 0 && (
                    <span className="text-[#f85149] ml-1.5">
                      {scan.failed_tasks}/{scan.total_tasks} failed
                    </span>
                  )}
                  <span className="mx-1.5 text-[#30363d]">·</span>
                  <span style={{ color }}>{total} finding{total !== 1 ? "s" : ""}</span>
                  {scan.critical > 0 && (
                    <span className="text-[#f85149] ml-1">({scan.critical} critical)</span>
                  )}
                </p>
              </div>
              <Link
                href={`/scan/${scan.id}`}
                className="flex items-center gap-1 text-xs text-[#388bfd] hover:text-[#58a6ff] transition-colors whitespace-nowrap"
              >
                View <ArrowRight size={11} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
