"use client";

import { useState } from "react";
import { Finding, resolveFinding, applyFinding } from "@/lib/api";
import { CheckCircle, Zap, Terminal, CheckCheck, ChevronDown, ChevronRight, WifiOff, Copy } from "lucide-react";

const SEV_STYLE: Record<string, { text: string; label: string }> = {
  critical: { text: "#f85149", label: "critical" },
  high:     { text: "#e3b341", label: "high"     },
  medium:   { text: "#d29922", label: "medium"   },
  low:      { text: "#388bfd", label: "low"      },
};

function kubectlCommand(f: Finding): string {
  const k = (f.kind ?? "").toLowerCase();
  const title = (f.title ?? "").toLowerCase();

  if (k.includes("restart") || title.includes("restart"))
    return `kubectl rollout restart deployment -n <namespace>`;
  if (k.includes("scale") || title.includes("replica"))
    return `kubectl scale deployment <name> --replicas=2 -n <namespace>`;
  if (k.includes("resource") || title.includes("resource limit") || title.includes("cpu") || title.includes("memory"))
    return `kubectl patch deployment <name> -n <namespace> --type=json \\\n  -p='[{"op":"add","path":"/spec/template/spec/containers/0/resources","value":{"requests":{"cpu":"100m","memory":"128Mi"},"limits":{"cpu":"500m","memory":"256Mi"}}}]'`;
  if (k.includes("probe") || title.includes("probe") || title.includes("liveness") || title.includes("readiness"))
    return `kubectl patch deployment <name> -n <namespace> --type=json \\\n  -p='[{"op":"add","path":"/spec/template/spec/containers/0/livenessProbe","value":{"httpGet":{"path":"/healthz","port":8080},"initialDelaySeconds":10,"periodSeconds":10}}]'`;
  if (f.diff_patch)
    return `kubectl apply -f - <<'EOF'\n${f.diff_patch.slice(0, 200)}...\nEOF`;
  return `kubectl apply -f fix.yaml -n <namespace>`;
}

interface Props {
  finding: Finding;
  onResolved?: (id: string) => void;
}

export default function RecommendationCard({ finding: f, onResolved }: Props) {
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [clusterDown, setClusterDown]       = useState(false);
  const [resolved, setResolved]             = useState(!!f.resolved_at);
  const [applied, setApplied]               = useState(false);
  const [applyLoading, setApplyLoading]     = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [diffOpen, setDiffOpen]             = useState(false);
  const [cmdOpen, setCmdOpen]               = useState(false);
  const [copied, setCopied]                 = useState(false);

  const sev = SEV_STYLE[f.severity] ?? { text: "#8b949e", label: f.severity };
  const cmd = kubectlCommand(f);

  async function handleApplyFix() {
    setApplyLoading(true);
    setError(null);
    setClusterDown(false);
    try {
      await applyFinding(f.id);
      setApplied(true);
      setShowApplyConfirm(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("connection refused") || msg.includes("dial tcp")) {
        setClusterDown(true);
        setShowApplyConfirm(false);
      } else {
        setError(msg);
      }
    } finally {
      setApplyLoading(false);
    }
  }

  function copyCmd() {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleResolve() {
    try {
      await resolveFinding(f.id);
      setResolved(true);
      onResolved?.(f.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      className={`bg-[#161b22] border border-[#21262d] rounded-lg p-4 flex flex-col gap-3 transition-opacity ${
        resolved ? "opacity-40" : ""
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0"
            style={{
              color: sev.text,
              background: `color-mix(in srgb, ${sev.text} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${sev.text} 30%, transparent)`,
            }}
          >
            {sev.label}
          </span>
          <span className="text-sm font-medium text-[#f0f6fc]">{f.title}</span>
        </div>
        {resolved && (
          <span className="flex items-center gap-1 text-[11px] text-[#3fb950] shrink-0">
            <CheckCircle size={12} />
            resolved
          </span>
        )}
      </div>

      <p className="text-xs text-[#8b949e] leading-relaxed">{f.detail}</p>

      {f.suggestion && (
        <p className="text-xs text-[#c9d1d9] leading-relaxed border-l-2 border-[#388bfd]/40 pl-3">
          {f.suggestion}
        </p>
      )}

      {/* kubectl command */}
      <div className={`rounded-md border overflow-hidden ${clusterDown ? "border-[#e3b341]/40" : "border-[#21262d]"}`}>
        <button
          onClick={() => setCmdOpen(o => !o)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${clusterDown ? "bg-[#e3b341]/8 hover:bg-[#e3b341]/12" : "bg-[#0d1117] hover:bg-[#0f1319]"}`}
        >
          {clusterDown
            ? <WifiOff size={11} className="text-[#e3b341] shrink-0" />
            : <Terminal size={11} className="text-[#3fb950] shrink-0" />
          }
          <span className={`text-[10px] font-mono flex-1 truncate ${clusterDown ? "text-[#e3b341]" : "text-[#3fb950]"}`}>
            {clusterDown ? "Cluster offline — run manually" : "kubectl command"}
          </span>
          <button
            onClick={e => { e.stopPropagation(); copyCmd(); }}
            className="text-[#484f58] hover:text-[#8b949e] transition-colors mr-1"
            title="Copy"
          >
            {copied ? <CheckCheck size={10} className="text-[#3fb950]" /> : <Copy size={10} />}
          </button>
          {cmdOpen
            ? <ChevronDown size={11} className="text-[#484f58] shrink-0" />
            : <ChevronRight size={11} className="text-[#484f58] shrink-0" />
          }
        </button>
        {(cmdOpen || clusterDown) && (
          <pre className={`px-3 py-2.5 text-[11px] font-mono border-t overflow-x-auto whitespace-pre leading-relaxed ${clusterDown ? "text-[#e3b341] bg-[#e3b341]/5 border-[#e3b341]/20" : "text-[#3fb950] bg-[#0d1117] border-[#21262d]"}`}>
            {cmd}
          </pre>
        )}
      </div>

      {f.diff_patch && (
        <div className="rounded-md border border-[#21262d] overflow-hidden">
          <button
            onClick={() => setDiffOpen(o => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-[#161b22] text-left hover:bg-[#1c2128] transition-colors"
          >
            <span className="text-[10px] text-[#8b949e] flex-1">Show diff</span>
            {diffOpen
              ? <ChevronDown size={11} className="text-[#484f58] shrink-0" />
              : <ChevronRight size={11} className="text-[#484f58] shrink-0" />
            }
          </button>
          {diffOpen && (
            <pre className="text-xs bg-[#0d1117] text-[#3fb950] border-t border-[#21262d] p-3 overflow-x-auto whitespace-pre font-mono">
              {f.diff_patch}
            </pre>
          )}
        </div>
      )}

      {clusterDown && (
        <div className="flex items-center gap-2 text-[11px] text-[#e3b341] bg-[#e3b341]/8 border border-[#e3b341]/20 rounded-md px-3 py-2">
          <WifiOff size={12} />
          Cluster unreachable — copy the command above and run it manually
        </div>
      )}
      {error && (
        <p className="text-[11px] text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {!resolved && (
        <>
          <div className="flex gap-2 flex-wrap">
            {f.diff_patch && !applied && (
              <button
                onClick={() => setShowApplyConfirm(true)}
                disabled={applyLoading}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-[#e3b341]/10 text-[#e3b341] border border-[#e3b341]/25 rounded-md hover:bg-[#e3b341]/15 disabled:opacity-50 transition-colors"
              >
                <Zap size={12} />
                {applyLoading ? "Applying…" : "Apply Fix"}
              </button>
            )}
            {applied && (
              <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 text-[#3fb950] border border-[#3fb950]/25 bg-[#3fb950]/8 rounded-md">
                <CheckCheck size={12} />
                Fix applied
              </span>
            )}
            <button
              onClick={handleResolve}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-[#3fb950]/8 text-[#3fb950] border border-[#3fb950]/25 rounded-md hover:bg-[#3fb950]/15 transition-colors ml-auto"
            >
              <CheckCircle size={12} />
              Mark Resolved
            </button>
          </div>

          {showApplyConfirm && (
            <div className="bg-[#e3b341]/8 border border-[#e3b341]/25 rounded-lg p-3 space-y-2.5">
              <p className="text-xs font-semibold text-[#e3b341]">Apply fix to live cluster?</p>
              <p className="text-xs text-[#8b949e]">
                Runs kubectl apply with the patch above. This modifies the live deployment.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleApplyFix}
                  disabled={applyLoading}
                  className="text-[11px] px-3 py-1.5 bg-[#e3b341] text-[#0d1117] font-semibold rounded-md hover:bg-[#d29922] disabled:opacity-50 transition-colors"
                >
                  {applyLoading ? "Applying…" : "Confirm Apply"}
                </button>
                <button
                  onClick={() => setShowApplyConfirm(false)}
                  className="text-[11px] px-3 py-1.5 border border-[#30363d] text-[#8b949e] rounded-md hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
