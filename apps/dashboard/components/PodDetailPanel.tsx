"use client";

import { useEffect, useRef, useState } from "react";
import { getPodLogs, PodInfo } from "@/lib/api";
import { X, Terminal, RefreshCw, Layers, Trash2, ChevronDown } from "lucide-react";

interface Props {
  pod: PodInfo;
  onClose: () => void;
  onRestart: (pod: PodInfo) => void;
  onScale: (pod: PodInfo) => void;
  onDelete: (pod: PodInfo) => void;
}

const PHASE_COLOR: Record<string, string> = {
  Running: "#3fb950", Pending: "#e3b341", Failed: "#f85149",
  Succeeded: "#388bfd", Unknown: "#484f58",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-[#21262d] last:border-0">
      <span className="text-[10px] text-[#8b949e] w-24 shrink-0 pt-0.5 font-medium">{label}</span>
      <span className="text-[11px] text-[#e6edf3] font-mono break-all leading-snug">{value || "—"}</span>
    </div>
  );
}

export default function PodDetailPanel({ pod, onClose, onRestart, onScale, onDelete }: Props) {
  const [container, setContainer] = useState(pod.containers[0] ?? "");
  const [logs, setLogs]   = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError]     = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const pc = PHASE_COLOR[pod.phase] ?? "#484f58";
  const dep = pod.name.replace(/-[a-z0-9]+-[a-z0-9]+$/, "");

  // Reset when pod changes
  useEffect(() => {
    setContainer(pod.containers[0] ?? "");
    setLogs("");
  }, [pod.name]);

  // Load logs whenever pod or container changes
  useEffect(() => {
    if (!pod.name) return;
    let cancelled = false;
    setLogsLoading(true);
    setLogsError(null);
    getPodLogs(pod.namespace, pod.name, { container, lines: 300 })
      .then(l => { if (!cancelled) { setLogs(l); setLogsLoading(false); } })
      .catch(e => { if (!cancelled) { setLogsError(String(e)); setLogsLoading(false); } });
    return () => { cancelled = true; };
  }, [pod.name, pod.namespace, container]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function refreshLogs() {
    setLogs(""); setLogsLoading(true); setLogsError(null);
    getPodLogs(pod.namespace, pod.name, { container, lines: 300 })
      .then(l => { setLogs(l); setLogsLoading(false); })
      .catch(e => { setLogsError(String(e)); setLogsLoading(false); });
  }

  return (
    <div className="flex flex-col h-full bg-[#161b22]">

      {/* ── Header ── */}
      <div className="shrink-0 px-4 pt-3 pb-3 border-b border-[#21262d]">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
              style={{
                color: pc,
                background: `color-mix(in srgb, ${pc} 10%, transparent)`,
                borderColor: `color-mix(in srgb, ${pc} 30%, transparent)`,
              }}
            >
              {pod.phase}
            </span>
            <p className="text-[11px] font-semibold text-[#f0f6fc] font-mono mt-1.5 break-all leading-snug">
              {pod.name}
            </p>
            <p className="text-[10px] text-[#388bfd] font-mono mt-0.5">{pod.namespace}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] rounded transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => onRestart(pod)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#388bfd]/50 hover:bg-[#388bfd]/5 transition-colors">
            <RefreshCw size={10} /> Restart
          </button>
          <button onClick={() => onScale(pod)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#388bfd]/50 hover:bg-[#388bfd]/5 transition-colors">
            <Layers size={10} /> Scale
          </button>
          <button onClick={() => onDelete(pod)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f85149] hover:border-[#f85149]/50 hover:bg-[#f85149]/5 transition-colors">
            <Trash2 size={10} /> Delete
          </button>
        </div>
      </div>

      {/* ── Pod info (scrollable, upper portion) ── */}
      <div className="overflow-y-auto px-4 py-3 space-y-4" style={{ flex: "0 0 auto", maxHeight: "42%" }}>

        <section>
          <p className="text-[9px] font-semibold text-[#484f58] uppercase tracking-widest mb-1.5">Status</p>
          <Field label="Phase"      value={pod.phase} />
          <Field label="Namespace"  value={pod.namespace} />
          <Field label="Node"       value={pod.node_name} />
          <Field label="Restarts"   value={String(pod.restarts)} />
          <Field label="Deployment" value={dep} />
        </section>

        <section>
          <p className="text-[9px] font-semibold text-[#484f58] uppercase tracking-widest mb-1.5">
            Containers ({pod.containers.length})
          </p>
          <div className="space-y-1">
            {pod.containers.map(c => (
              <button
                key={c}
                onClick={() => setContainer(c)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded border text-left transition-colors ${
                  c === container
                    ? "border-[#388bfd]/40 bg-[#388bfd]/8 text-[#388bfd]"
                    : "border-[#21262d] bg-[#1c2128] text-[#e6edf3] hover:border-[#388bfd]/30"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0" />
                <span className="text-[11px] font-mono truncate">{c}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ── Log terminal (pinned to bottom, takes remaining space) ── */}
      <div className="flex-1 flex flex-col min-h-0 border-t border-[#21262d]">
        {/* Terminal toolbar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#1c2128] border-b border-[#21262d]">
          <Terminal size={11} className="text-[#3fb950] shrink-0" />
          <span className="text-[10px] font-mono text-[#484f58] truncate flex-1">
            logs · {container || pod.containers[0]}
          </span>

          {pod.containers.length > 1 && (
            <div className="relative">
              <select
                value={container}
                onChange={e => setContainer(e.target.value)}
                className="appearance-none text-[10px] bg-[#161b22] border border-[#30363d] rounded px-2 pr-5 py-0.5 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd]"
              >
                {pod.containers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={9} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[#8b949e]" />
            </div>
          )}

          <button onClick={refreshLogs}
            className="text-[#8b949e] hover:text-[#f0f6fc] transition-colors"
            title="Refresh">
            <RefreshCw size={11} />
          </button>
        </div>

        {/* Log output */}
        <div className="flex-1 min-h-0 bg-[#0d1117] overflow-hidden">
          {logsLoading && (
            <div className="flex items-center justify-center h-full text-[11px] text-[#8b949e] font-mono animate-pulse">
              Loading…
            </div>
          )}
          {logsError && (
            <div className="p-3 text-[11px] text-[#f85149] font-mono">{logsError}</div>
          )}
          {!logsLoading && !logsError && (
            <pre
              ref={logRef}
              className="h-full overflow-y-auto p-3 text-[11px] text-[#3fb950] font-mono leading-relaxed whitespace-pre-wrap break-words"
            >
              {logs || "(no output)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
