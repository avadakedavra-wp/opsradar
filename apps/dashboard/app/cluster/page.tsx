"use client";

import { useEffect, useState } from "react";
import {
  listContexts, listNamespaces, listPods,
  restartDeployment, scaleDeployment, deletePod,
  PodInfo,
} from "@/lib/api";
import PodDetailPanel from "@/components/PodDetailPanel";
import {
  AlertCircle, CheckCircle, X, Layers, ChevronDown,
  LayoutDashboard, Box, Cpu, Database, Globe, Shield, Briefcase, Clock,
} from "lucide-react";

const SUB_NAV = [
  { id: "overview",    label: "Overview",                Icon: LayoutDashboard },
  { id: "pods",        label: "Pods",                   Icon: Box             },
  { id: "deployments", label: "Deployments",            Icon: Cpu             },
  { id: "daemonsets",  label: "Daemon Sets",            Icon: Database        },
  { id: "statefulsets",label: "Stateful Sets",          Icon: Database        },
  { id: "replicasets", label: "Replica Sets",           Icon: Globe           },
  { id: "jobs",        label: "Jobs",                   Icon: Briefcase       },
  { id: "cronjobs",    label: "Cron Jobs",              Icon: Clock           },
];

function PhaseDot({ phase }: { phase: string }) {
  const colors: Record<string, string> = {
    Running: "#3fb950", Pending: "#e3b341", Failed: "#f85149",
    Succeeded: "#388bfd", Unknown: "#484f58",
  };
  const c = colors[phase] ?? "#484f58";
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color: c }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />
      {phase}
    </span>
  );
}

export default function ClusterPage() {
  const [view, setView]           = useState("pods");
  const [contexts, setContexts]   = useState<string[]>([]);
  const [context, setContext]     = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [pods, setPods]           = useState<PodInfo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<PodInfo | null>(null);
  const [toast, setToast]         = useState<{ text: string; ok: boolean } | null>(null);

  // Scale modal state
  const [scaleTarget, setScaleTarget] = useState<{ ns: string; dep: string } | null>(null);
  const [scaleValue, setScaleValue]   = useState(2);
  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<PodInfo | null>(null);

  useEffect(() => {
    listContexts().then(setContexts).catch(() => {});
  }, []);

  useEffect(() => {
    listNamespaces(context).then(setNamespaces).catch(() => {});
  }, [context]);

  useEffect(() => {
    setLoading(true); setError(null);
    listPods(namespace, context)
      .then(p  => { setPods(p);  setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [namespace, context]);

  function notify(text: string, ok = true) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), ok ? 4000 : 6000);
  }

  async function handleRestart(pod: PodInfo) {
    const dep = pod.name.replace(/-[a-z0-9]+-[a-z0-9]+$/, "");
    try { await restartDeployment(pod.namespace, dep, context); notify(`Restart triggered: ${dep}`); }
    catch (e: unknown) { notify(String(e), false); }
  }

  function handleScale(pod: PodInfo) {
    const dep = pod.name.replace(/-[a-z0-9]+-[a-z0-9]+$/, "");
    setScaleTarget({ ns: pod.namespace, dep });
    setScaleValue(2);
  }

  async function doScale() {
    if (!scaleTarget) return;
    try {
      await scaleDeployment(scaleTarget.ns, scaleTarget.dep, scaleValue, context);
      notify(`Scaled ${scaleTarget.dep} → ${scaleValue} replicas`);
      setScaleTarget(null);
    } catch (e: unknown) { notify(String(e), false); }
  }

  async function doDelete(pod: PodInfo) {
    try {
      await deletePod(pod.namespace, pod.name, context);
      setConfirmDelete(null);
      if (selected?.name === pod.name) setSelected(null);
      notify(`Pod ${pod.name} deleted`);
      setPods(prev => prev.filter(p => p.name !== pod.name));
    } catch (e: unknown) { notify(String(e), false); }
  }

  const running = pods.filter(p => p.phase === "Running").length;
  const pending = pods.filter(p => p.phase === "Pending").length;
  const failed  = pods.filter(p => p.phase === "Failed").length;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sub-navigation ── */}
      <nav className="w-44 shrink-0 bg-[#0d1117] border-r border-[#21262d] py-3 overflow-y-auto">
        <div className="px-3 mb-2">
          <span className="text-[9px] font-semibold text-[#484f58] uppercase tracking-widest">Workloads</span>
        </div>
        {SUB_NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
              view === id
                ? "text-[#f0f6fc] font-medium bg-[#21262d]"
                : "text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#161b22]"
            }`}
          >
            <Icon size={13} className={view === id ? "text-[#388bfd]" : ""} />
            {label}
          </button>
        ))}
      </nav>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Page header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[#21262d] bg-[#0d1117]">
          <div>
            <h1 className="text-sm font-semibold text-[#f0f6fc] capitalize">{view}</h1>
            {view === "pods" && (
              <p className="text-[10px] text-[#8b949e] mt-0.5">
                {pods.length} total ·{" "}
                <span className="text-[#3fb950]">{running} running</span>
                {pending > 0 && <span className="text-[#e3b341] ml-1.5">{pending} pending</span>}
                {failed  > 0 && <span className="text-[#f85149] ml-1.5">{failed} failed</span>}
              </p>
            )}
          </div>
          {view === "pods" && (
            <div className="flex items-center gap-2">
              {contexts.length > 1 && (
                <div className="relative">
                  <select
                    value={context}
                    onChange={e => { setContext(e.target.value); setNamespace(""); }}
                    className="appearance-none text-[11px] bg-[#161b22] border border-[#388bfd]/40 rounded-md pl-3 pr-6 py-1.5 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd] cursor-pointer"
                  >
                    <option value="">All contexts</option>
                    {contexts.map(ctx => <option key={ctx} value={ctx}>{ctx}</option>)}
                  </select>
                  <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e]" />
                </div>
              )}
              <div className="relative">
                <select
                  value={namespace}
                  onChange={e => setNamespace(e.target.value)}
                  className="appearance-none text-[11px] bg-[#161b22] border border-[#30363d] rounded-md pl-3 pr-6 py-1.5 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd] cursor-pointer"
                >
                  <option value="">All namespaces</option>
                  {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                </select>
                <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e]" />
              </div>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className={`shrink-0 flex items-center gap-2 text-xs mx-5 mt-2 rounded-md px-3 py-2 border ${
            toast.ok
              ? "text-[#3fb950] bg-[#3fb950]/8 border-[#3fb950]/20"
              : "text-[#f85149] bg-[#f85149]/8 border-[#f85149]/20"
          }`}>
            {toast.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            {toast.text}
          </div>
        )}

        {/* Content + detail panel side by side */}
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {view !== "pods" ? (
              <div className="flex items-center justify-center h-full text-xs text-[#484f58]">
                No data for {view} yet.
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md m-5 px-3 py-2">
                <AlertCircle size={12} /> {error}
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">Loading pods…</div>
            ) : pods.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-[#8b949e] border border-dashed border-[#21262d] rounded-lg m-5">
                No pods{namespace ? ` in "${namespace}"` : ""}.
              </div>
            ) : (
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#161b22] border-b border-[#21262d]">
                    <th className="text-left px-4 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Name</th>
                    <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden sm:table-cell">Namespace</th>
                    <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden md:table-cell">Containers</th>
                    <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Status</th>
                    <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden sm:table-cell">Restarts</th>
                    <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden lg:table-cell">Node</th>
                  </tr>
                </thead>
                <tbody>
                  {pods.map((pod, idx) => {
                    const isSelected = selected?.name === pod.name;
                    return (
                      <tr
                        key={pod.name}
                        onClick={() => setSelected(isSelected ? null : pod)}
                        className={`border-b border-[#21262d] cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[#1f6feb]/15 border-l-2 border-l-[#388bfd]"
                            : idx % 2 === 0
                              ? "bg-[#0d1117] hover:bg-[#161b22]"
                              : "bg-[#0f1319] hover:bg-[#161b22]"
                        }`}
                      >
                        <td className="px-4 py-2.5 font-mono text-[#e6edf3] truncate max-w-[200px]" title={pod.name}>
                          {pod.name}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[#388bfd] hidden sm:table-cell">
                          {pod.namespace}
                        </td>
                        <td className="px-3 py-2.5 text-[#8b949e] hidden md:table-cell">
                          {pod.containers.length}
                        </td>
                        <td className="px-3 py-2.5">
                          <PhaseDot phase={pod.phase} />
                        </td>
                        <td className="px-3 py-2.5 font-mono hidden sm:table-cell">
                          {pod.restarts > 0
                            ? <span className="text-[#e3b341]">{pod.restarts}</span>
                            : <span className="text-[#484f58]">0</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-[#8b949e] font-mono truncate max-w-[120px] hidden lg:table-cell" title={pod.node_name}>
                          {pod.node_name || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Pod detail panel ── */}
          {selected && (
            <div className="w-[340px] shrink-0 overflow-hidden border-l border-[#21262d]">
              <PodDetailPanel
                pod={selected}
                onClose={() => setSelected(null)}
                onRestart={p => { handleRestart(p); }}
                onScale={p => handleScale(p)}
                onDelete={p => setConfirmDelete(p)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Scale modal */}
      {scaleTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={e => { if (e.target === e.currentTarget) setScaleTarget(null); }}
        >
          <div className="bg-[#161b22] border border-[#21262d] rounded-lg shadow-2xl p-5 w-full max-w-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Scale Deployment</h3>
              <button onClick={() => setScaleTarget(null)} className="text-[#8b949e] hover:text-[#f0f6fc]"><X size={14} /></button>
            </div>
            <p className="text-xs text-[#8b949e] font-mono">{scaleTarget.ns}/{scaleTarget.dep}</p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-[#8b949e]">Replicas</label>
              <input
                type="number" min={0} max={50} value={scaleValue}
                onChange={e => setScaleValue(Number(e.target.value))}
                className="w-20 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-[#f0f6fc] focus:outline-none focus:border-[#388bfd]"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setScaleTarget(null)} className="text-xs px-3 py-1.5 border border-[#30363d] text-[#8b949e] rounded-md hover:bg-[#21262d] transition-colors">Cancel</button>
              <button onClick={doScale} className="text-xs px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md transition-colors">Scale</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="bg-[#161b22] border border-[#21262d] rounded-lg shadow-2xl p-5 w-full max-w-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Delete Pod</h3>
              <button onClick={() => setConfirmDelete(null)} className="text-[#8b949e] hover:text-[#f0f6fc]"><X size={14} /></button>
            </div>
            <p className="text-xs text-[#8b949e]">
              Delete <span className="font-mono text-[#f0f6fc]">{confirmDelete.name}</span>? k8s will recreate it.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="text-xs px-3 py-1.5 border border-[#30363d] text-[#8b949e] rounded-md hover:bg-[#21262d] transition-colors">Cancel</button>
              <button onClick={() => doDelete(confirmDelete)} className="text-xs px-3 py-1.5 bg-[#da3633] hover:bg-[#f85149] text-white rounded-md transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
