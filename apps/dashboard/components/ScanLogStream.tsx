"use client";

import { useEffect, useRef } from "react";
import { ProgressEvent, streamScan } from "@/lib/api";

interface Props {
  scanId: string;
  onDone?: () => void;
}

export default function ScanLogStream({ scanId, onDone }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scanId) return;
    const stop = streamScan(scanId, (event: ProgressEvent) => {
      if (!linesRef.current) return;
      const line = document.createElement("div");
      line.className = "font-mono text-sm whitespace-pre-wrap";
      const sev = event.finding?.severity;
      if (sev === "critical") line.className += " text-red-400";
      else if (sev === "high") line.className += " text-orange-400";
      else if (sev === "medium") line.className += " text-yellow-400";
      else line.className += " text-green-300";
      line.textContent = `[${new Date().toLocaleTimeString()}] ${event.message}`;
      linesRef.current.appendChild(line);
      // auto-scroll
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
      if (event.done) onDone?.();
    });
    return stop;
  }, [scanId, onDone]);

  return (
    <div
      ref={containerRef}
      className="bg-[#0d1117] rounded-lg p-4 h-80 overflow-y-auto border border-[#21262d]"
    >
      <div className="text-[#484f58] text-[10px] mb-3 font-mono">scan stream · {scanId}</div>
      <div ref={linesRef} />
    </div>
  );
}
