"use client";

import { RadarRow } from "@/lib/api";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600",
  high: "bg-orange-500",
  medium: "bg-yellow-400",
  low: "bg-blue-400",
  clean: "bg-green-500",
};

interface Props {
  data: RadarRow[];
}

function cellColor(row: RadarRow): string {
  if (row.critical > 0) return SEVERITY_COLORS.critical;
  if (row.high > 0) return SEVERITY_COLORS.high;
  if (row.medium > 0) return SEVERITY_COLORS.medium;
  if (row.low > 0) return SEVERITY_COLORS.low;
  return SEVERITY_COLORS.clean;
}

function totalFindings(row: RadarRow): number {
  return row.critical + row.high + row.medium + row.low;
}

export default function RadarHeatmap({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm border border-dashed rounded-lg">
        No scan data yet — run a scan to populate the radar.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {data.map((row) => (
        <div
          key={row.namespace}
          className={`${cellColor(row)} rounded-xl p-4 text-white shadow flex flex-col gap-1`}
        >
          <span className="font-semibold text-sm truncate">{row.namespace}</span>
          <span className="text-xs opacity-80">{totalFindings(row)} findings</span>
          <div className="flex gap-1 mt-1 flex-wrap text-xs font-mono">
            {row.critical > 0 && <span>C:{row.critical}</span>}
            {row.high > 0 && <span>H:{row.high}</span>}
            {row.medium > 0 && <span>M:{row.medium}</span>}
            {row.low > 0 && <span>L:{row.low}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
