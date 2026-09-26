"use client";

import { useEffect, useRef, useState } from "react";
import { getPodLogs } from "@/lib/api";
import { X, Terminal } from "lucide-react";

interface Props {
  namespace: string;
  pod: string;
  containers: string[];
  context?: string;
  onClose: () => void;
}

export default function PodLogsModal({ namespace, pod, containers, context, onClose }: Props) {
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [container, setContainer] = useState(containers[0] ?? "");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPodLogs(namespace, pod, { container, lines: 200, context })
      .then((l) => { if (!cancelled) { setLogs(l); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [namespace, pod, container, context]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0d1117] border border-[#21262d] rounded-lg shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal size={14} className="text-[#3fb950] shrink-0" />
            <span className="font-mono text-xs text-[#8b949e]">{namespace}/</span>
            <span className="font-mono text-xs text-[#f0f6fc] font-semibold truncate">{pod}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {containers.length > 1 && (
              <select
                value={container}
                onChange={(e) => setContainer(e.target.value)}
                className="text-xs bg-[#161b22] border border-[#30363d] rounded-md px-2 py-1 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd]"
              >
                {containers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Log body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-64 text-[#8b949e] text-xs font-mono">
              Loading logs…
            </div>
          )}
          {error && (
            <div className="p-4 text-[#f85149] text-xs font-mono">{error}</div>
          )}
          {!loading && !error && (
            <>
              <div className="px-4 py-2 text-[10px] font-mono text-[#484f58] border-b border-[#21262d]">
                last 200 lines · {namespace}/{pod}
              </div>
              <pre
                ref={logRef}
                className="p-4 text-[#3fb950] text-xs font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap break-words"
                style={{ maxHeight: "calc(85vh - 90px)" }}
              >
                {logs || "(no output)"}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
