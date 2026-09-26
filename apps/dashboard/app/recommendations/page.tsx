"use client";

import { useEffect, useState } from "react";
import { listScans, listContexts, listNamespaces, listFindings, Scan, Finding } from "@/lib/api";
import RecommendationCard from "@/components/RecommendationCard";
import { AlertCircle, ChevronDown, ShieldAlert } from "lucide-react";

function Select({
  value, onChange, children, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="appearance-none text-xs bg-[#161b22] border border-[#30363d] rounded-md pl-3 pr-7 py-1.5 text-[#f0f6fc] focus:outline-none focus:border-[#388bfd] transition-colors disabled:opacity-40 cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e]" />
    </div>
  );
}

const SEV_ORDER = ["critical", "high", "medium", "low"];

export default function RecommendationsPage() {
  const [scans, setScans]         = useState<Scan[]>([]);
  const [contexts, setContexts]   = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);

  const [ctx, setCtx]             = useState("");   // selected k8s context
  const [ns, setNs]               = useState("");   // selected namespace (visual filter only)
  const [selectedScan, setSelectedScan] = useState("");
  const [sevFilter, setSevFilter] = useState("");   // "" = all

  const [findings, setFindings]   = useState<Finding[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Load k8s contexts
  useEffect(() => {
    listContexts().then(setContexts).catch(() => {});
  }, []);

  // Load namespaces when context changes
  useEffect(() => {
    setNs("");
    listNamespaces(ctx).then(setNamespaces).catch(() => {});
  }, [ctx]);

  // Load scans (filtered by cluster_name matching ctx if set)
  useEffect(() => {
    listScans()
      .then(s => {
        setScans(s);
        // Auto-select first scan matching the context
        const match = ctx ? s.find(x => x.cluster_name.includes(ctx)) ?? s[0] : s[0];
        if (match) setSelectedScan(match.id);
      })
      .catch(e => setError(String(e)));
  }, [ctx]);

  // Load findings when scan changes
  useEffect(() => {
    if (!selectedScan) return;
    setLoading(true);
    listFindings(selectedScan)
      .then(setFindings)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedScan]);

  // Cluster_name → short display label
  const visibleScans = ctx
    ? scans.filter(s => s.cluster_name.includes(ctx))
    : scans;

  // Severity filter
  const displayed = sevFilter
    ? findings.filter(f => f.severity === sevFilter)
    : findings;

  const counts = SEV_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = findings.filter(f => f.severity === s).length;
    return acc;
  }, {});

  const SEV_COLORS: Record<string, string> = {
    critical: "#f85149", high: "#e3b341", medium: "#d29922", low: "#388bfd",
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Filter bar ── */}
      <div className="shrink-0 flex items-center gap-3 flex-wrap px-5 py-3 border-b border-[#21262d] bg-[#0d1117]">
        <ShieldAlert size={14} className="text-[#8b949e]" />
        <span className="text-sm font-semibold text-[#f0f6fc]">Findings</span>
        <span className="text-[#21262d]">|</span>

        {/* Context */}
        {contexts.length > 0 && (
          <Select value={ctx} onChange={v => setCtx(v)}>
            <option value="">All contexts</option>
            {contexts.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}

        {/* Namespace (visual) */}
        {namespaces.length > 0 && (
          <Select value={ns} onChange={setNs}>
            <option value="">All namespaces</option>
            {namespaces.map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
        )}

        {/* Scan */}
        {visibleScans.length > 0 && (
          <Select value={selectedScan} onChange={setSelectedScan}>
            {visibleScans.map(s => (
              <option key={s.id} value={s.id}>
                {s.cluster_name} — {new Date(s.started_at).toLocaleString()}
              </option>
            ))}
          </Select>
        )}

        {/* Severity filter pills */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => setSevFilter("")}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
              sevFilter === ""
                ? "border-[#388bfd]/40 bg-[#388bfd]/10 text-[#388bfd]"
                : "border-[#30363d] text-[#8b949e] hover:border-[#388bfd]/30"
            }`}
          >
            All ({findings.length})
          </button>
          {SEV_ORDER.filter(s => counts[s] > 0).map(s => (
            <button
              key={s}
              onClick={() => setSevFilter(prev => prev === s ? "" : s)}
              className="text-[10px] px-2 py-1 rounded-full border transition-colors"
              style={{
                color: sevFilter === s ? SEV_COLORS[s] : "#8b949e",
                borderColor: sevFilter === s ? `${SEV_COLORS[s]}60` : "#30363d",
                background: sevFilter === s ? `${SEV_COLORS[s]}15` : "transparent",
              }}
            >
              {s} ({counts[s]})
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md px-3 py-2 mb-4">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {loading ? (
          <div className="text-xs text-[#8b949e] py-16 text-center">Loading findings…</div>
        ) : displayed.length === 0 ? (
          <div className="text-xs text-[#8b949e] py-12 text-center border border-dashed border-[#21262d] rounded-lg">
            {findings.length === 0 ? "No findings for this scan." : `No ${sevFilter} findings.`}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {displayed.map(f => (
              <RecommendationCard
                key={f.id}
                finding={f}
                onResolved={rid =>
                  setFindings(prev =>
                    prev.map(x => x.id === rid ? { ...x, resolved_at: new Date().toISOString() } : x)
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
