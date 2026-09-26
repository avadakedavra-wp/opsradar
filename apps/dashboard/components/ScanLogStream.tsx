"use client";

import { useEffect, useRef, useState } from "react";
import { ProgressEvent, streamScan } from "@/lib/api";
import { Radar, CheckCircle, Loader } from "lucide-react";

interface Props {
  scanId: string;
  onDone?: () => void;
}

interface LogLine {
  id: number;
  ts: string;
  message: string;
  severity?: string; // set when the event carried a finding
}

type Status = "connecting" | "running" | "done";

const SEV: Record<string, string> = {
  critical: "#f85149",
  high:     "#e3b341",
  medium:   "#d29922",
  low:      "#388bfd",
};

export default function ScanLogStream({ scanId, onDone }: Props) {
  const [lines, setLines]   = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [counts, setCounts] = useState({ critical: 0, high: 0, medium: 0, low: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);
  const idRef   = useRef(0);

  useEffect(() => {
    if (!scanId) return;
    setLines([]);
    setStatus("connecting");
    setCounts({ critical: 0, high: 0, medium: 0, low: 0 });

    const stop = streamScan(scanId, (event: ProgressEvent) => {
      setStatus(event.done ? "done" : "running");

      setLines(prev => [
        ...prev,
        {
          id: idRef.current++,
          ts: new Date().toLocaleTimeString([], { hour12: false }),
          message: event.message,
          severity: event.finding?.severity,
        },
      ]);

      const sev = event.finding?.severity;
      if (sev && sev in SEV) {
        setCounts(prev => ({ ...prev, [sev]: prev[sev as keyof typeof prev] + 1 }));
      }

      if (event.done) onDone?.();
    });
    return stop;
  }, [scanId, onDone]);

  // Auto-scroll to the newest line.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const running = status !== "done";
  const totalFindings = counts.critical + counts.high + counts.medium + counts.low;

  return (
    <div className="rounded-lg border border-[#21262d] overflow-hidden bg-[#0d1117]">
      {/* Status header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[#21262d] bg-[#161b22]">
        {running ? (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#388bfd] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#388bfd]" />
          </span>
        ) : (
          <CheckCircle size={13} className="text-[#3fb950] shrink-0" />
        )}
        <span className="text-[12px] font-semibold text-[#f0f6fc] flex items-center gap-1.5">
          {running
            ? <><Radar size={12} className="text-[#388bfd]" /> Scanning cluster…</>
            : <>Scan complete</>
          }
        </span>

        {/* Live severity tally */}
        <div className="ml-auto flex items-center gap-1.5">
          {totalFindings === 0 ? (
            <span className="text-[10px] text-[#484f58] font-mono">
              {lines.length} event{lines.length !== 1 ? "s" : ""}
            </span>
          ) : (
            (["critical", "high", "medium", "low"] as const).map(s =>
              counts[s] > 0 ? (
                <span key={s} className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ color: SEV[s], background: `color-mix(in srgb, ${SEV[s]} 12%, transparent)` }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: SEV[s] }} />
                  {counts[s]}
                </span>
              ) : null
            )
          )}
        </div>
      </div>

      {/* Log body */}
      <div ref={bodyRef} className="h-80 overflow-y-auto px-4 py-3 space-y-0.5">
        {lines.length === 0 && (
          <div className="flex items-center gap-2 text-[12px] text-[#484f58] font-mono py-2">
            <Loader size={12} className="animate-spin" />
            Connecting to scan stream…
          </div>
        )}
        {lines.map(line => {
          const color = line.severity ? SEV[line.severity] : undefined;
          return (
            <div key={line.id} className="flex items-start gap-2 text-[12px] font-mono leading-relaxed">
              <span className="text-[#484f58] shrink-0 tabular-nums">{line.ts}</span>
              {line.severity && (
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              )}
              <span
                className="whitespace-pre-wrap break-words"
                style={{ color: color ?? "#8b949e" }}
              >
                {line.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
