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
      className="bg-gray-950 rounded-xl p-4 h-96 overflow-y-auto border border-gray-800"
    >
      <div className="text-gray-500 text-xs mb-2 font-mono">— scan stream: {scanId} —</div>
      <div ref={linesRef} />
    </div>
  );
}
