"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listContexts, listNamespaces, listPods,
  listDeployments, listDaemonSets, listStatefulSets,
  listReplicaSets, listJobs, listCronJobs,
  restartDeployment, scaleDeployment, deletePod,
  PodInfo, WorkloadInfo, JobInfo, CronJobInfo,
} from "@/lib/api";
import ResourceDetailDrawer, { ResourceRef } from "@/components/ResourceDetailDrawer";
import { useBob } from "@/lib/bob-context";
import {
  AlertCircle, CheckCircle, X, ChevronDown,
  LayoutDashboard, Box, Cpu, Database, Globe, Briefcase, Clock,
  RefreshCw, MessageCircle, Search,
} from "lucide-react";

const SUB_NAV = [
  { id: "overview",    label: "Overview",     Icon: LayoutDashboard },
  { id: "pods",        label: "Pods",         Icon: Box             },
  { id: "deployments", label: "Deployments",  Icon: Cpu             },
  { id: "daemonsets",  label: "Daemon Sets",  Icon: Database        },
  { id: "statefulsets",label: "Stateful Sets",Icon: Database        },
  { id: "replicasets", label: "Replica Sets", Icon: Globe           },
  { id: "jobs",        label: "Jobs",         Icon: Briefcase       },
  { id: "cronjobs",    label: "Cron Jobs",    Icon: Clock           },
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

function ReadyBadge({ ready, ok }: { ready: string; ok?: boolean }) {
  const color = ok === false ? "#f85149" : ok === true ? "#3fb950" : "#8b949e";
  return <span className="font-mono text-[11px]" style={{ color }}>{ready}</span>;
}

// ── Workload table for Deployments / DaemonSets / StatefulSets / ReplicaSets ──
function WorkloadTable({ items, loading, error, kind, context, selectedName, onSelect }: {
  items: WorkloadInfo[];
  loading: boolean;
  error: string | null;
  kind: string;
  context: string;
  selectedName?: string;
  onSelect: (r: ResourceRef) => void;
}) {
  if (error) return (
    <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md m-5 px-3 py-2">
      <AlertCircle size={12} /> {error}
    </div>
  );
  if (loading) return (
    <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">Loading…</div>
  );
  if (items.length === 0) return (
    <div className="flex items-center justify-center h-full text-xs text-[#8b949e] border border-dashed border-[#21262d] rounded-lg m-5">
      No resources found.
    </div>
  );

  return (
    <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#161b22] border-b border-[#21262d]">
          <th className="text-left px-4 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Name</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden sm:table-cell">Namespace</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Ready</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden md:table-cell">Image</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Age</th>
        </tr>
      </thead>
      <tbody>
        {items.map((w, idx) => {
          const [readyStr, totalStr] = w.ready.split("/");
          const ready = parseInt(readyStr ?? "0");
          const total = parseInt(totalStr ?? "0");
          const ok = total > 0 ? ready === total : undefined;
          const isSel = selectedName === w.name;
          return (
            <tr
              key={w.name}
              onClick={() => onSelect({ kind, name: w.name, namespace: w.namespace, context, workload: w })}
              className={`border-b border-[#21262d] cursor-pointer transition-colors ${
                isSel
                  ? "bg-[#1f6feb]/15 border-l-2 border-l-[#388bfd]"
                  : `${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#0f1319]"} hover:bg-[#161b22]`
              }`}
            >
              <td className="px-4 py-2.5 font-mono text-[#e6edf3] truncate max-w-[220px]" title={w.name}>{w.name}</td>
              <td className="px-3 py-2.5 font-mono text-[#388bfd] hidden sm:table-cell">{w.namespace}</td>
              <td className="px-3 py-2.5"><ReadyBadge ready={w.ready} ok={ok} /></td>
              <td className="px-3 py-2.5 font-mono text-[#8b949e] truncate max-w-[200px] hidden md:table-cell" title={w.image}>
                {w.image ? w.image.split("/").pop() : "—"}
              </td>
              <td className="px-3 py-2.5 text-[#8b949e]">{w.age}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Jobs table ────────────────────────────────────────────────────────────────
function JobsTable({ items, loading, error, context, selectedName, onSelect }: {
  items: JobInfo[];
  loading: boolean;
  error: string | null;
  context: string;
  selectedName?: string;
  onSelect: (r: ResourceRef) => void;
}) {
  if (error) return (
    <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md m-5 px-3 py-2">
      <AlertCircle size={12} /> {error}
    </div>
  );
  if (loading) return <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">Loading…</div>;
  if (items.length === 0) return (
    <div className="flex items-center justify-center h-full text-xs text-[#8b949e] border border-dashed border-[#21262d] rounded-lg m-5">No jobs found.</div>
  );

  const statusColor = (s: string) => s === "Complete" ? "#3fb950" : s === "Failed" ? "#f85149" : "#e3b341";

  return (
    <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#161b22] border-b border-[#21262d]">
          <th className="text-left px-4 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Name</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden sm:table-cell">Namespace</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Completions</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Status</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden md:table-cell">Duration</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Age</th>
        </tr>
      </thead>
      <tbody>
        {items.map((j, idx) => {
          const isSel = selectedName === j.name;
          return (
          <tr key={j.name}
            onClick={() => onSelect({ kind: "Job", name: j.name, namespace: j.namespace, context })}
            className={`border-b border-[#21262d] cursor-pointer transition-colors ${
              isSel ? "bg-[#1f6feb]/15 border-l-2 border-l-[#388bfd]" : `${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#0f1319]"} hover:bg-[#161b22]`
            }`}>
            <td className="px-4 py-2.5 font-mono text-[#e6edf3] truncate max-w-[220px]" title={j.name}>{j.name}</td>
            <td className="px-3 py-2.5 font-mono text-[#388bfd] hidden sm:table-cell">{j.namespace}</td>
            <td className="px-3 py-2.5 font-mono text-[#8b949e]">{j.completions}</td>
            <td className="px-3 py-2.5">
              <span className="text-[11px] font-medium" style={{ color: statusColor(j.status) }}>{j.status}</span>
            </td>
            <td className="px-3 py-2.5 text-[#8b949e] hidden md:table-cell">{j.duration}</td>
            <td className="px-3 py-2.5 text-[#8b949e]">{j.age}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── CronJobs table ────────────────────────────────────────────────────────────
function CronJobsTable({ items, loading, error, context, selectedName, onSelect }: {
  items: CronJobInfo[];
  loading: boolean;
  error: string | null;
  context: string;
  selectedName?: string;
  onSelect: (r: ResourceRef) => void;
}) {
  if (error) return (
    <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md m-5 px-3 py-2">
      <AlertCircle size={12} /> {error}
    </div>
  );
  if (loading) return <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">Loading…</div>;
  if (items.length === 0) return (
    <div className="flex items-center justify-center h-full text-xs text-[#8b949e] border border-dashed border-[#21262d] rounded-lg m-5">No cron jobs found.</div>
  );

  return (
    <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#161b22] border-b border-[#21262d]">
          <th className="text-left px-4 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Name</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden sm:table-cell">Namespace</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Schedule</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden sm:table-cell">Active</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider hidden md:table-cell">Last Run</th>
          <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] font-medium uppercase tracking-wider">Age</th>
        </tr>
      </thead>
      <tbody>
        {items.map((cj, idx) => {
          const isSel = selectedName === cj.name;
          return (
          <tr key={cj.name}
            onClick={() => onSelect({ kind: "CronJob", name: cj.name, namespace: cj.namespace, context })}
            className={`border-b border-[#21262d] cursor-pointer transition-colors ${
              isSel ? "bg-[#1f6feb]/15 border-l-2 border-l-[#388bfd]" : `${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#0f1319]"} hover:bg-[#161b22]`
            }`}>
            <td className="px-4 py-2.5 font-mono text-[#e6edf3] truncate max-w-[220px]" title={cj.name}>
              {cj.name}
              {cj.suspend && <span className="ml-2 text-[10px] text-[#e3b341] border border-[#e3b341]/30 rounded px-1">suspended</span>}
            </td>
            <td className="px-3 py-2.5 font-mono text-[#388bfd] hidden sm:table-cell">{cj.namespace}</td>
            <td className="px-3 py-2.5 font-mono text-[#8b949e]">{cj.schedule}</td>
            <td className="px-3 py-2.5 font-mono hidden sm:table-cell">
              {cj.active > 0
                ? <span className="text-[#3fb950]">{cj.active}</span>
                : <span className="text-[#484f58]">0</span>}
            </td>
            <td className="px-3 py-2.5 text-[#8b949e] hidden md:table-cell">{cj.last_run}</td>
            <td className="px-3 py-2.5 text-[#8b949e]">{cj.age}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewPanel({ pods, deployments, daemonsets, statefulsets, jobs, cronjobs, loading }: {
  pods: PodInfo[];
  deployments: WorkloadInfo[];
  daemonsets: WorkloadInfo[];
  statefulsets: WorkloadInfo[];
  jobs: JobInfo[];
  cronjobs: CronJobInfo[];
  loading: boolean;
}) {
  const stat = (label: string, value: number | string, color?: string) => (
    <div className="bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-3">
      <div className="text-[20px] font-bold font-mono" style={{ color: color ?? "#f0f6fc" }}>{value}</div>
      <div className="text-[10px] text-[#8b949e] mt-0.5 uppercase tracking-wider">{label}</div>
    </div>
  );

  const running = pods.filter(p => p.phase === "Running").length;
  const failed  = pods.filter(p => p.phase === "Failed").length;
  const depReady = deployments.filter(d => { const [r, t] = d.ready.split("/"); return r === t && parseInt(t) > 0; }).length;
  const jobsFailed = jobs.filter(j => j.status === "Failed").length;

  return loading ? (
    <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">Loading…</div>
  ) : (
    <div className="p-5 space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stat("Pods", pods.length)}
        {stat("Running", running, "#3fb950")}
        {stat("Failed", failed, failed > 0 ? "#f85149" : "#484f58")}
        {stat("Deployments", deployments.length)}
        {stat("Ready", depReady, depReady === deployments.length ? "#3fb950" : "#e3b341")}
        {stat("Cron Jobs", cronjobs.length)}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stat("Daemon Sets", daemonsets.length)}
        {stat("Stateful Sets", statefulsets.length)}
        {stat("Jobs", jobs.length)}
        {stat("Jobs Failed", jobsFailed, jobsFailed > 0 ? "#f85149" : "#484f58")}
      </div>
    </div>
  );
}

// ── Drag handle to resize the detail drawer ────────────────────────────────────
function DrawerResizer({ onWidth, onToggle }: { onWidth: (w: number) => void; onToggle: () => void }) {
  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      // Width = distance from the viewport's right edge to the cursor.
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 380), window.innerWidth - 240);
      onWidth(w);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  return (
    <div
      onMouseDown={startDrag}
      onDoubleClick={onToggle}
      title="Drag to resize · double-click to expand"
      className="w-1.5 shrink-0 cursor-col-resize bg-[#21262d] hover:bg-[#388bfd]/50 active:bg-[#388bfd] transition-colors"
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ClusterPage() {
  const { openBob } = useBob();
  const [view, setView]             = useState("pods");
  const [contexts, setContexts]     = useState<string[]>([]);
  const [context, setContext]       = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace]   = useState("");

  const [pods,         setPods]         = useState<PodInfo[]>([]);
  const [deployments,  setDeployments]  = useState<WorkloadInfo[]>([]);
  const [daemonsets,   setDaemonsets]   = useState<WorkloadInfo[]>([]);
  const [statefulsets, setStatefulsets] = useState<WorkloadInfo[]>([]);
  const [replicasets,  setReplicasets]  = useState<WorkloadInfo[]>([]);
  const [jobs,         setJobs]         = useState<JobInfo[]>([]);
  const [cronjobs,     setCronjobs]     = useState<CronJobInfo[]>([]);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [query,   setQuery]   = useState(""); // filters the current view by name/namespace
  const [selected, setSelected] = useState<ResourceRef | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(460); // resizable detail drawer
  const [toast,    setToast]    = useState<{ text: string; ok: boolean } | null>(null);

  const [scaleTarget,    setScaleTarget]   = useState<{ ns: string; dep: string } | null>(null);
  const [scaleValue,     setScaleValue]    = useState(2);
  const [confirmDelete,  setConfirmDelete] = useState<ResourceRef | null>(null);

  useEffect(() => { listContexts().then(setContexts).catch(() => {}); }, []);
  useEffect(() => { listNamespaces(context).then(setNamespaces).catch(() => {}); }, [context]);

  const loadAll = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      listPods(namespace, context).then(setPods).catch(e => setError(String(e))),
      listDeployments(namespace, context).then(setDeployments).catch(() => {}),
      listDaemonSets(namespace, context).then(setDaemonsets).catch(() => {}),
      listStatefulSets(namespace, context).then(setStatefulsets).catch(() => {}),
      listReplicaSets(namespace, context).then(setReplicasets).catch(() => {}),
      listJobs(namespace, context).then(setJobs).catch(() => {}),
      listCronJobs(namespace, context).then(setCronjobs).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [namespace, context]);

  useEffect(() => { loadAll(); }, [loadAll]);

  function notify(text: string, ok = true) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), ok ? 4000 : 6000);
  }

  // Deployment name: a Deployment ref uses its own name; a Pod ref derives its
  // owning deployment by stripping the replicaset + pod hash suffix.
  function deploymentName(r: ResourceRef) {
    return r.kind === "Deployment" ? r.name : r.name.replace(/-[a-z0-9]+-[a-z0-9]+$/, "");
  }

  async function handleRestart(r: ResourceRef) {
    const dep = deploymentName(r);
    try { await restartDeployment(r.namespace, dep, context); notify(`Restart triggered: ${dep}`); }
    catch (e: unknown) { notify(String(e), false); }
  }

  function handleScale(r: ResourceRef) {
    setScaleTarget({ ns: r.namespace, dep: deploymentName(r) });
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

  async function doDelete(r: ResourceRef) {
    try {
      await deletePod(r.namespace, r.name, context);
      setConfirmDelete(null);
      if (selected?.name === r.name) setSelected(null);
      notify(`Pod ${r.name} deleted`);
      setPods(prev => prev.filter(p => p.name !== r.name));
    } catch (e: unknown) { notify(String(e), false); }
  }

  const running = pods.filter(p => p.phase === "Running").length;
  const pending = pods.filter(p => p.phase === "Pending").length;
  const failed  = pods.filter(p => p.phase === "Failed").length;

  // Case-insensitive filter on name + namespace, applied to the current view.
  const q = query.trim().toLowerCase();
  const match = (name: string, ns: string) =>
    q === "" || name.toLowerCase().includes(q) || ns.toLowerCase().includes(q);

  const fPods         = pods.filter(p => match(p.name, p.namespace));
  const fDeployments  = deployments.filter(w => match(w.name, w.namespace));
  const fDaemonsets   = daemonsets.filter(w => match(w.name, w.namespace));
  const fStatefulsets = statefulsets.filter(w => match(w.name, w.namespace));
  const fReplicasets  = replicasets.filter(w => match(w.name, w.namespace));
  const fJobs         = jobs.filter(j => match(j.name, j.namespace));
  const fCronjobs     = cronjobs.filter(cj => match(cj.name, cj.namespace));

  // header subtitle varies by view (shows filtered/total when searching)
  const withQ = (shown: number, total: number, noun: string) =>
    q ? `${shown} of ${total} ${noun} match “${query.trim()}”` : `${total} ${noun}`;
  const subtitle: Record<string, string> = {
    pods:         q
      ? `${fPods.length} of ${pods.length} pods match “${query.trim()}”`
      : `${pods.length} total · ${running} running${pending > 0 ? ` · ${pending} pending` : ""}${failed > 0 ? ` · ${failed} failed` : ""}`,
    deployments:  withQ(fDeployments.length,  deployments.length,  "deployments"),
    daemonsets:   withQ(fDaemonsets.length,   daemonsets.length,   "daemon sets"),
    statefulsets: withQ(fStatefulsets.length, statefulsets.length, "stateful sets"),
    replicasets:  withQ(fReplicasets.length,  replicasets.length,  "replica sets"),
    jobs:         withQ(fJobs.length,         jobs.length,         "jobs"),
    cronjobs:     withQ(fCronjobs.length,     cronjobs.length,     "cron jobs"),
    overview:     "Cluster summary",
  };

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Sub-nav ── */}
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

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[#21262d] bg-[#0d1117]">
          <div>
            <h1 className="text-sm font-semibold text-[#f0f6fc] capitalize">{view.replace("sets", " Sets").replace("jobs", " Jobs")}</h1>
            <p className="text-[10px] text-[#8b949e] mt-0.5">{subtitle[view] ?? ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {view !== "overview" && (
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#484f58]" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name…"
                  className="w-48 text-[11px] bg-[#161b22] border border-[#30363d] rounded-md pl-7 pr-7 py-1.5 text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] transition-colors"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    title="Clear"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#f0f6fc]"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
            <button
              onClick={loadAll}
              className="p-1.5 rounded-md text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
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

        {/* Content */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto min-w-0">
            {view === "overview" && (
              <OverviewPanel
                pods={pods} deployments={deployments} daemonsets={daemonsets}
                statefulsets={statefulsets} jobs={jobs} cronjobs={cronjobs}
                loading={loading}
              />
            )}
            {view === "pods" && (
              error ? (
                <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md m-5 px-3 py-2">
                  <AlertCircle size={12} /> {error}
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">Loading pods…</div>
              ) : pods.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-[#8b949e] border border-dashed border-[#21262d] rounded-lg m-5">
                  No pods{namespace ? ` in "${namespace}"` : ""}.
                </div>
              ) : fPods.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-[#8b949e] border border-dashed border-[#21262d] rounded-lg m-5">
                  No pods match “{query.trim()}”.
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
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {fPods.map((pod, idx) => {
                      const isSelected = selected?.name === pod.name;
                      const isTroubled = pod.phase !== "Running" || pod.restarts > 0 || !pod.ready;
                      return (
                        <tr
                          key={pod.name}
                          onClick={() => setSelected(isSelected ? null : { kind: "Pod", name: pod.name, namespace: pod.namespace, context, pod })}
                          className={`border-b border-[#21262d] cursor-pointer transition-colors group ${
                            isSelected
                              ? "bg-[#1f6feb]/15 border-l-2 border-l-[#388bfd]"
                              : idx % 2 === 0
                                ? "bg-[#0d1117] hover:bg-[#161b22]"
                                : "bg-[#0f1319] hover:bg-[#161b22]"
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono text-[#e6edf3] truncate max-w-[200px]" title={pod.name}>{pod.name}</td>
                          <td className="px-3 py-2.5 font-mono text-[#388bfd] hidden sm:table-cell">{pod.namespace}</td>
                          <td className="px-3 py-2.5 text-[#8b949e] hidden md:table-cell">{pod.containers.length}</td>
                          <td className="px-3 py-2.5"><PhaseDot phase={pod.phase} /></td>
                          <td className="px-3 py-2.5 font-mono hidden sm:table-cell">
                            {pod.restarts > 0
                              ? <span className="text-[#e3b341]">{pod.restarts}</span>
                              : <span className="text-[#484f58]">0</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[#8b949e] font-mono truncate max-w-[120px] hidden lg:table-cell" title={pod.node_name}>
                            {pod.node_name || "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                openBob({ namespace: pod.namespace, pod: pod.name, k8sContext: context });
                              }}
                              title="Ask Bob about this pod"
                              className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-all ${
                                isTroubled
                                  ? "text-[#f85149] border border-[#f85149]/30 hover:bg-[#f85149]/10"
                                  : "text-[#8b949e] border border-[#30363d] hover:text-[#388bfd] hover:border-[#388bfd]/30"
                              }`}
                            >
                              <MessageCircle size={9} /> Bob
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}
            {view === "deployments"  && <WorkloadTable items={fDeployments}  loading={loading} error={error} kind="Deployment"  context={context} selectedName={selected?.name} onSelect={setSelected} />}
            {view === "daemonsets"   && <WorkloadTable items={fDaemonsets}   loading={loading} error={error} kind="DaemonSet"   context={context} selectedName={selected?.name} onSelect={setSelected} />}
            {view === "statefulsets" && <WorkloadTable items={fStatefulsets} loading={loading} error={error} kind="StatefulSet" context={context} selectedName={selected?.name} onSelect={setSelected} />}
            {view === "replicasets"  && <WorkloadTable items={fReplicasets}  loading={loading} error={error} kind="ReplicaSet"  context={context} selectedName={selected?.name} onSelect={setSelected} />}
            {view === "jobs"         && <JobsTable     items={fJobs}         loading={loading} error={error} context={context} selectedName={selected?.name} onSelect={setSelected} />}
            {view === "cronjobs"     && <CronJobsTable items={fCronjobs}     loading={loading} error={error} context={context} selectedName={selected?.name} onSelect={setSelected} />}
          </div>

          {/* Resource detail drawer — YAML for every kind, logs/exec for pods.
              Left edge is a drag handle; double-click toggles wide/normal. */}
          {selected && view !== "overview" && (
            <div className="shrink-0 flex overflow-hidden" style={{ width: drawerWidth }}>
              <DrawerResizer
                onWidth={setDrawerWidth}
                onToggle={() => setDrawerWidth(w =>
                  w > 620 ? 460 : Math.min(900, window.innerWidth - 300)
                )}
              />
              <div className="flex-1 min-w-0 overflow-hidden">
                <ResourceDetailDrawer
                  resource={selected}
                  onClose={() => setSelected(null)}
                  onRestart={handleRestart}
                  onScale={handleScale}
                  onDelete={setConfirmDelete}
                  onAskBob={r => openBob({ namespace: r.namespace, pod: r.name, k8sContext: context })}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scale modal */}
      {scaleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={e => { if (e.target === e.currentTarget) setScaleTarget(null); }}>
          <div className="bg-[#161b22] border border-[#21262d] rounded-lg shadow-2xl p-5 w-full max-w-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#f0f6fc]">Scale Deployment</h3>
              <button onClick={() => setScaleTarget(null)} className="text-[#8b949e] hover:text-[#f0f6fc]"><X size={14} /></button>
            </div>
            <p className="text-xs text-[#8b949e] font-mono">{scaleTarget.ns}/{scaleTarget.dep}</p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-[#8b949e]">Replicas</label>
              <input type="number" min={0} max={50} value={scaleValue}
                onChange={e => setScaleValue(Number(e.target.value))}
                className="w-20 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-sm text-[#f0f6fc] focus:outline-none focus:border-[#388bfd]" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
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
