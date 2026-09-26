"use client";

import { Scan } from "@/lib/api";
import Link from "next/link";

interface Props {
  scans: Scan[];
}

const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  medium: "bg-yellow-400",
  low: "bg-blue-400",
};

function worstSeverity(scan: Scan): string {
  if (scan.critical > 0) return "critical";
  if (scan.high > 0) return "high";
  if (scan.medium > 0) return "medium";
  if (scan.low > 0) return "low";
  return "clean";
}

export default function HistoryTimeline({ scans }: Props) {
  if (scans.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm border border-dashed rounded-lg">
        No scan history yet.
      </div>
    );
  }

  return (
    <div className="relative pl-6 border-l-2 border-gray-200 flex flex-col gap-6">
      {scans.map((scan) => {
        const sev = worstSeverity(scan);
        const total = scan.critical + scan.high + scan.medium + scan.low;
        return (
          <div key={scan.id} className="relative">
            <span
              className={`absolute -left-[1.6rem] top-1.5 w-4 h-4 rounded-full border-2 border-white ${SEV_DOT[sev] ?? "bg-green-500"}`}
            />
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-medium">
                  {scan.cluster_name} — {new Date(scan.started_at).toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Status: <span className={scan.status === "completed" ? "text-green-600" : "text-gray-400"}>{scan.status}</span>
                  {" · "}
                  {total} finding{total !== 1 ? "s" : ""}
                  {scan.critical > 0 && <span className="text-red-500 ml-1">({scan.critical} critical)</span>}
                </p>
              </div>
              <Link
                href={`/scan/${scan.id}`}
                className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
              >
                View →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
