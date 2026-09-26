"use client";

import { useState } from "react";
import { Finding, generatePR, resolveFinding } from "@/lib/api";

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-400 text-gray-900",
  low: "bg-blue-500 text-white",
};

interface Props {
  finding: Finding;
  onResolved?: (id: string) => void;
}

export default function RecommendationCard({ finding: f, onResolved }: Props) {
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(!!f.resolved_at);

  async function handleGeneratePR() {
    setLoading(true);
    setError(null);
    try {
      const { pr_url } = await generatePR(f.id);
      setPrUrl(pr_url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
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
    <div className={`border rounded-xl p-4 flex flex-col gap-2 ${resolved ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mr-2 ${SEV_BADGE[f.severity] ?? "bg-gray-200"}`}>
            {f.severity}
          </span>
          <span className="font-medium">{f.title}</span>
        </div>
        {resolved && <span className="text-xs text-green-600 font-semibold">✓ resolved</span>}
      </div>

      <p className="text-sm text-gray-600">{f.detail}</p>

      {f.suggestion && (
        <p className="text-sm text-gray-500 italic">💡 {f.suggestion}</p>
      )}

      {f.diff_patch && (
        <details className="mt-1">
          <summary className="text-xs text-gray-400 cursor-pointer">Show diff patch</summary>
          <pre className="mt-2 text-xs bg-gray-950 text-green-300 p-3 rounded overflow-x-auto whitespace-pre">
            {f.diff_patch}
          </pre>
        </details>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {!resolved && (
        <div className="flex gap-2 mt-1">
          {f.diff_patch && (
            <button
              onClick={handleGeneratePR}
              disabled={loading || !!prUrl}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "Creating PR…" : prUrl ? "PR created ✓" : "Generate PR"}
            </button>
          )}
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Open PR ↗
            </a>
          )}
          <button
            onClick={handleResolve}
            className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100"
          >
            Mark Resolved
          </button>
        </div>
      )}
    </div>
  );
}
