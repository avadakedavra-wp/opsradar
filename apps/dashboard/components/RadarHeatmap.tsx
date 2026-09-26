"use client";

import { RadarRow } from "@/lib/api";

function cellStyle(row: RadarRow): { bg: string; border: string; accent: string } {
  if (row.critical > 0) return { bg: "#f85149/10", border: "#f85149/30", accent: "#f85149" };
  if (row.high > 0)     return { bg: "#e3b341/10", border: "#e3b341/30", accent: "#e3b341" };
  if (row.medium > 0)   return { bg: "#d29922/10", border: "#d29922/30", accent: "#d29922" };
  if (row.low > 0)      return { bg: "#388bfd/10", border: "#388bfd/30", accent: "#388bfd" };
  return { bg: "#3fb950/10", border: "#3fb950/30", accent: "#3fb950" };
}

interface Props {
  data: RadarRow[];
}

function totalFindings(row: RadarRow): number {
  return row.critical + row.high + row.medium + row.low;
}

export default function RadarHeatmap({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[#8b949e] text-xs border border-dashed border-[#21262d] rounded-lg">
        No scan data yet — run a scan to populate the radar.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {data.map((row) => {
        const style = cellStyle(row);
        const total = totalFindings(row);
        return (
          <div
            key={row.namespace}
            className="rounded-lg p-3 flex flex-col gap-1.5 border"
            style={{
              background: `color-mix(in srgb, ${style.accent} 8%, #161b22)`,
              borderColor: `color-mix(in srgb, ${style.accent} 30%, #21262d)`,
            }}
          >
            <span
              className="text-xs font-semibold font-mono truncate"
              style={{ color: style.accent }}
            >
              {row.namespace}
            </span>
            <span className="text-[10px] text-[#8b949e]">
              {total === 0 ? "clean" : `${total} finding${total !== 1 ? "s" : ""}`}
            </span>
            {total > 0 && (
              <div className="flex gap-1.5 text-[10px] font-mono text-[#8b949e]">
                {row.critical > 0 && <span className="text-[#f85149]">C:{row.critical}</span>}
                {row.high > 0     && <span className="text-[#e3b341]">H:{row.high}</span>}
                {row.medium > 0   && <span className="text-[#d29922]">M:{row.medium}</span>}
                {row.low > 0      && <span className="text-[#388bfd]">L:{row.low}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
