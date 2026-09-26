"use client";

import { useEffect, useState } from "react";
import { getHAAnalysis, HAFinding } from "@/lib/api";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";

const SEV_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  high:   { text: "#f85149", bg: "#f85149/10", border: "#f85149/30" },
  medium: { text: "#e3b341", bg: "#e3b341/10", border: "#e3b341/30" },
  low:    { text: "#388bfd", bg: "#388bfd/10", border: "#388bfd/30" },
};

function SevBadge({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity] ?? { text: "#8b949e", bg: "#8b949e/10", border: "#8b949e/30" };
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0"
      style={{
        color: s.text,
        background: `color-mix(in srgb, ${s.text} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${s.text} 30%, transparent)`,
      }}
    >
      {severity}
    </span>
  );
}

export default function HAAnalysisSection() {
  const [findings, setFindings] = useState<HAFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getHAAnalysis()
      .then((f) => { setFindings(f); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading || error) return null;

  if (findings.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-[#f0f6fc] mb-3">High Availability</h2>
        <div className="flex items-center gap-2.5 text-xs text-[#3fb950] border border-[#3fb950]/20 bg-[#3fb950]/5 rounded-lg px-4 py-3">
          <ShieldCheck size={14} />
          No HA issues detected — all deployments have redundancy configured.
        </div>
      </section>
    );
  }

  const visible = expanded ? findings : findings.slice(0, 4);
  const highCount = findings.filter((f) => f.severity === "high").length;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#f0f6fc]">High Availability</h2>
        <span className="text-[11px] text-[#8b949e]">
          {findings.length} issue{findings.length !== 1 ? "s" : ""}
        </span>
      </div>

      {highCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-[#e3b341] bg-[#e3b341]/8 border border-[#e3b341]/20 rounded-lg px-3 py-2 mb-3">
          <ShieldAlert size={13} />
          {highCount} deployment{highCount !== 1 ? "s" : ""} running as a single replica — any node failure causes downtime.
        </div>
      )}

      <div className="space-y-1.5">
        {visible.map((f, i) => (
          <div key={i} className="flex items-start gap-3 bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-3">
            <SevBadge severity={f.severity} />
            <div className="min-w-0">
              <p className="text-sm text-[#f0f6fc]">
                <span className="font-mono text-[#8b949e]">{f.namespace}/</span>
                <span className="font-medium">{f.deployment}</span>
                <span className="text-[#484f58] mx-1.5">·</span>
                <span className="text-[#c9d1d9]">{f.issue}</span>
              </p>
              <p className="text-xs text-[#8b949e] mt-0.5">{f.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {findings.length > 4 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-xs text-[#388bfd] hover:text-[#58a6ff] transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "Show less" : `Show ${findings.length - 4} more`}
        </button>
      )}
    </section>
  );
}
