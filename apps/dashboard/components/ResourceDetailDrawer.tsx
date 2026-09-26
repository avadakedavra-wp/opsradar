"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getPodLogs, getResourceYAML, PodInfo, WorkloadInfo } from "@/lib/api";
import {
  X, Terminal, RefreshCw, Layers, Trash2, ChevronDown,
  FileCode2, Copy, CheckCheck, Info, MessageCircle, SquareTerminal,
} from "lucide-react";

// xterm is browser-only; never evaluate it during SSR.
const PodExecTerminal = dynamic(() => import("./PodExecTerminal"), { ssr: false });

export interface ResourceRef {
  kind: string;       // "Pod" | "Deployment" | "DaemonSet" | ...
  name: string;
  namespace: string;
  context: string;
  pod?: PodInfo;         // present when kind === "Pod"
  workload?: WorkloadInfo;
}

interface Props {
  resource: ResourceRef;
  onClose: () => void;
  onRestart?: (r: ResourceRef) => void;
  onScale?: (r: ResourceRef) => void;
  onDelete?: (r: ResourceRef) => void;
  onAskBob?: (r: ResourceRef) => void;
}

const PHASE_COLOR: Record<string, string> = {
  Running: "#3fb950", Pending: "#e3b341", Failed: "#f85149",
  Succeeded: "#388bfd", Unknown: "#484f58",
};

type Tab = "overview" | "yaml" | "logs" | "exec";

// ── YAML viewer: line numbers + minimal key/value tinting ──────────────────────
function YamlView({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <div className="h-full overflow-auto bg-[#0d1117] font-mono text-[11px] leading-[1.6]">
      <table style={{ borderCollapse: "collapse" }} className="w-full">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="select-none text-right pr-3 pl-3 text-[#484f58] align-top w-[1%] whitespace-nowrap sticky left-0 bg-[#0d1117]">
                {i + 1}
              </td>
              <td className="pr-4 align-top whitespace-pre">{renderYamlLine(line)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderYamlLine(line: string): React.ReactNode {
  if (line.trim().startsWith("#")) {
    return <span className="text-[#484f58]">{line}</span>;
  }
  // Split "  key: value" → indent + key + value, keeping list dashes.
  const m = line.match(/^(\s*-?\s*)([A-Za-z0-9_.\-/]+)(:)(\s.*)?$/);
  if (m) {
    const [, indent, key, colon, rest = ""] = m;
    return (
      <>
        <span>{indent}</span>
        <span className="text-[#79c0ff]">{key}</span>
        <span className="text-[#8b949e]">{colon}</span>
        <span className="text-[#a5d6ff]">{rest}</span>
      </>
    );
  }
  return <span className="text-[#c9d1d9]">{line}</span>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-[#21262d] last:border-0">
      <span className="text-[10px] text-[#8b949e] w-24 shrink-0 pt-0.5 font-medium">{label}</span>
      <span className="text-[11px] text-[#e6edf3] font-mono break-all leading-snug">{value || "—"}</span>
    </div>
  );
}

export default function ResourceDetailDrawer({
  resource, onClose, onRestart, onScale, onDelete, onAskBob,
}: Props) {
  const { kind, name, namespace, context, pod, workload } = resource;
  const isPod = kind === "Pod";
  // Backend currently supports rollout restart + scale on Deployments only;
  // a Pod restarts via its owning Deployment. Only expose what actually works.
  const canRestart = isPod || kind === "Deployment";
  const canScale   = kind === "Deployment";

  const [tab, setTab] = useState<Tab>("overview");

  // YAML state
  const [yaml, setYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Logs state (pods only)
  const [container, setContainer] = useState(pod?.containers[0] ?? "");
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // Reset tab + caches when the selected resource changes.
  useEffect(() => {
    setTab("overview");
    setYaml(""); setYamlError(null);
    setContainer(pod?.containers[0] ?? "");
    setLogs("");
  }, [kind, name, namespace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load YAML when the tab is active or the resource/context changes.
  // NOTE: yaml/yamlLoading are deliberately NOT deps — including them makes
  // setYamlLoading(true) re-run this effect, whose cleanup cancels the very
  // request it just started (the bug that left YAML permanently blank).
  useEffect(() => {
    if (tab !== "yaml") return;
    let cancelled = false;
    setYamlLoading(true); setYamlError(null);
    getResourceYAML(kind, name, namespace, context)
      .then(y => { if (!cancelled) setYaml(y); })
      .catch(e => { if (!cancelled) setYamlError(String(e)); })
      .finally(() => { if (!cancelled) setYamlLoading(false); });
    return () => { cancelled = true; };
  }, [tab, kind, name, namespace, context]);

  // Load logs when the logs tab opens or the container changes.
  useEffect(() => {
    if (tab !== "logs" || !isPod) return;
    let cancelled = false;
    setLogsLoading(true); setLogsError(null);
    getPodLogs(namespace, name, { container, lines: 500, context })
      .then(l => { if (!cancelled) setLogs(l); })
      .catch(e => { if (!cancelled) setLogsError(String(e)); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, isPod, namespace, name, container, context]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function copyYaml() {
    navigator.clipboard.writeText(yaml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  function refreshLogs() {
    setLogsLoading(true); setLogsError(null); setLogs("");
    getPodLogs(namespace, name, { container, lines: 500, context })
      .then(setLogs).catch(e => setLogsError(String(e))).finally(() => setLogsLoading(false));
  }

  const pc = isPod ? (PHASE_COLOR[pod?.phase ?? ""] ?? "#484f58") : "#388bfd";
  const statusText = isPod ? (pod?.phase ?? "") : (workload?.ready ?? kind);

  const TABS: { id: Tab; label: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
    { id: "overview", label: "Overview", Icon: Info },
    { id: "yaml",     label: "YAML",     Icon: FileCode2 },
    ...(isPod ? [
      { id: "logs" as Tab, label: "Logs", Icon: Terminal },
      { id: "exec" as Tab, label: "Exec", Icon: SquareTerminal },
    ] : []),
  ];

  return (
    <div className="flex flex-col h-full bg-[#161b22]">
      {/* ── Header ── */}
      <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-[#21262d]">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#388bfd]/10 border border-[#388bfd]/25 text-[#388bfd] uppercase tracking-wide">
                {kind}
              </span>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                style={{ color: pc, background: `color-mix(in srgb, ${pc} 10%, transparent)`, borderColor: `color-mix(in srgb, ${pc} 30%, transparent)` }}
              >
                {statusText}
              </span>
            </div>
            <p className="text-[12px] font-semibold text-[#f0f6fc] font-mono mt-1.5 break-all leading-snug">{name}</p>
            <p className="text-[10px] text-[#388bfd] font-mono mt-0.5">{namespace || "cluster-scoped"}</p>
          </div>
          <button onClick={onClose} className="shrink-0 p-1 text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] rounded transition-colors">
            <X size={13} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-1 flex-wrap">
          {canRestart && onRestart && (
            <button onClick={() => onRestart(resource)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#388bfd]/50 hover:bg-[#388bfd]/5 transition-colors">
              <RefreshCw size={10} /> Restart
            </button>
          )}
          {canScale && onScale && (
            <button onClick={() => onScale(resource)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#388bfd]/50 hover:bg-[#388bfd]/5 transition-colors">
              <Layers size={10} /> Scale
            </button>
          )}
          {isPod && onAskBob && (
            <button onClick={() => onAskBob(resource)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#388bfd] hover:border-[#388bfd]/50 hover:bg-[#388bfd]/5 transition-colors">
              <MessageCircle size={10} /> Ask Bob
            </button>
          )}
          {isPod && onDelete && (
            <button onClick={() => onDelete(resource)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f85149] hover:border-[#f85149]/50 hover:bg-[#f85149]/5 transition-colors">
              <Trash2 size={10} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 border-b border-[#21262d] bg-[#0d1117]">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-[#388bfd] text-[#f0f6fc]"
                : "border-transparent text-[#8b949e] hover:text-[#f0f6fc]"
            }`}>
            <Icon size={11} className={tab === id ? "text-[#388bfd]" : ""} /> {label}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "overview" && (
          <div className="h-full overflow-y-auto px-4 py-3 space-y-4">
            <section>
              <p className="text-[9px] font-semibold text-[#484f58] uppercase tracking-widest mb-1.5">Metadata</p>
              <Field label="Kind" value={kind} />
              <Field label="Name" value={name} />
              <Field label="Namespace" value={namespace} />
              {isPod && pod && <>
                <Field label="Phase" value={pod.phase} />
                <Field label="Node" value={pod.node_name} />
                <Field label="Restarts" value={String(pod.restarts)} />
              </>}
              {!isPod && workload && <>
                <Field label="Ready" value={workload.ready} />
                <Field label="Image" value={workload.image} />
                <Field label="Age" value={workload.age} />
              </>}
            </section>

            {isPod && pod && (
              <section>
                <p className="text-[9px] font-semibold text-[#484f58] uppercase tracking-widest mb-1.5">
                  Containers ({pod.containers.length})
                </p>
                <div className="space-y-1">
                  {pod.containers.map(c => (
                    <div key={c} className="flex items-center gap-2 px-3 py-1.5 rounded border border-[#21262d] bg-[#1c2128]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0" />
                      <span className="text-[11px] font-mono text-[#e6edf3] truncate">{c}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <button onClick={() => setTab("yaml")}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] py-2 rounded border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#388bfd]/40 transition-colors">
              <FileCode2 size={11} /> View full YAML
            </button>
          </div>
        )}

        {tab === "yaml" && (
          <div className="h-full flex flex-col">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#1c2128] border-b border-[#21262d]">
              <FileCode2 size={11} className="text-[#8b949e] shrink-0" />
              <span className="text-[10px] font-mono text-[#484f58] flex-1 truncate">{kind.toLowerCase()}/{name}</span>
              <button onClick={copyYaml} disabled={!yaml}
                className="flex items-center gap-1 text-[10px] text-[#8b949e] hover:text-[#f0f6fc] disabled:opacity-40 transition-colors">
                {copied ? <CheckCheck size={10} className="text-[#3fb950]" /> : <Copy size={10} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {yamlLoading && <div className="flex items-center justify-center h-full text-[11px] text-[#8b949e] font-mono animate-pulse">Loading YAML…</div>}
              {yamlError && <div className="p-3 text-[11px] text-[#f85149] font-mono">{yamlError}</div>}
              {!yamlLoading && !yamlError && (yaml ? <YamlView text={yaml} /> : <div className="flex items-center justify-center h-full text-[11px] text-[#484f58]">No manifest.</div>)}
            </div>
          </div>
        )}

        {tab === "logs" && isPod && (
          <div className="h-full flex flex-col">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#1c2128] border-b border-[#21262d]">
              <Terminal size={11} className="text-[#3fb950] shrink-0" />
              <span className="text-[10px] font-mono text-[#484f58] truncate flex-1">logs · {container}</span>
              {pod && pod.containers.length > 1 && (
                <div className="relative">
                  <select value={container} onChange={e => setContainer(e.target.value)}
                    className="appearance-none text-[10px] bg-[#161b22] border border-[#30363d] rounded px-2 pr-5 py-0.5 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd]">
                    {pod.containers.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={9} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[#8b949e]" />
                </div>
              )}
              <button onClick={refreshLogs} className="text-[#8b949e] hover:text-[#f0f6fc] transition-colors" title="Refresh">
                <RefreshCw size={11} />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-[#0d1117]">
              {logsLoading && <div className="flex items-center justify-center h-full text-[11px] text-[#8b949e] font-mono animate-pulse">Loading…</div>}
              {logsError && <div className="p-3 text-[11px] text-[#f85149] font-mono">{logsError}</div>}
              {!logsLoading && !logsError && (
                <pre ref={logRef} className="h-full overflow-y-auto p-3 text-[11px] text-[#3fb950] font-mono leading-relaxed whitespace-pre-wrap break-words">
                  {logs || "(no output)"}
                </pre>
              )}
            </div>
          </div>
        )}

        {tab === "exec" && isPod && (
          <div className="h-full flex flex-col">
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#1c2128] border-b border-[#21262d]">
              <SquareTerminal size={11} className="text-[#3fb950] shrink-0" />
              <span className="text-[10px] font-mono text-[#484f58] truncate flex-1">
                sh · {container || pod?.containers[0]}
              </span>
              {pod && pod.containers.length > 1 && (
                <div className="relative">
                  <select value={container} onChange={e => setContainer(e.target.value)}
                    className="appearance-none text-[10px] bg-[#161b22] border border-[#30363d] rounded px-2 pr-5 py-0.5 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd]">
                    {pod.containers.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={9} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[#8b949e]" />
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 bg-[#0d1117]">
              {/* key forces a fresh terminal + socket when the container changes */}
              <PodExecTerminal
                key={`${name}/${container}`}
                namespace={namespace}
                pod={name}
                container={container}
                context={context}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
