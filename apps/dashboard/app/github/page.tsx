"use client";

import { useState, useEffect, useCallback } from "react";
import { scanGitHubRepos, listLocalRepos, applyRepoFix, LocalRepo, RepoFinding } from "@/lib/api";
import {
  GitBranch, FolderOpen, Plus, X, Zap,
  AlertCircle, ChevronRight, ChevronDown, FolderSearch,
  FileCode2, Copy, CheckCheck, ShieldAlert, CircleDot,
  Info, TriangleAlert, OctagonX, Layers, GitPullRequest, Loader,
} from "lucide-react";

// ── Severity helpers ────────────────────────────────────────────────────────

const SEV: Record<string, { color: string; bg: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  critical: { color: "#f85149", bg: "#f85149/12", Icon: OctagonX       },
  high:     { color: "#e3b341", bg: "#e3b341/10", Icon: TriangleAlert   },
  medium:   { color: "#d29922", bg: "#d29922/10", Icon: AlertCircle     },
  low:      { color: "#388bfd", bg: "#388bfd/10", Icon: CircleDot       },
  info:     { color: "#8b949e", bg: "#8b949e/10", Icon: Info            },
};

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

function SevIcon({ severity, size = 13 }: { severity: string; size?: number }) {
  const s = SEV[severity] ?? SEV.info;
  return <span style={{ color: s.color, display: "inline-flex" }}><s.Icon size={size} /></span>;
}

// ── FindingRow ───────────────────────────────────────────────────────────────

function FindingRow({ f, repoPath }: { f: RepoFinding; repoPath: string }) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);
  const [prState, setPrState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [prUrl,   setPrUrl]   = useState("");
  const [prNote,  setPrNote]  = useState("");

  function copyFix() {
    navigator.clipboard.writeText(f.fix).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  async function createPR(e: React.MouseEvent) {
    e.stopPropagation();
    if (!repoPath) { setPrNote("Repo path unknown — re-add the repo."); setPrState("error"); return; }
    setPrState("loading");
    try {
      const res = await applyRepoFix({ repoPath, file: f.file, fix: f.fix, title: f.title, detail: f.detail });
      setPrUrl(res.pr_url);
      setPrNote(res.note ?? "");
      setPrState("done");
    } catch (err: unknown) {
      setPrNote(String(err));
      setPrState("error");
    }
  }

  const s = SEV[f.severity] ?? SEV.info;

  return (
    <div
      className="border-b border-[#21262d] last:border-0 cursor-pointer"
      onClick={() => setOpen(o => !o)}
    >
      {/* Row */}
      <div
        className="flex items-start gap-3 px-4 py-2 hover:bg-[#161b22] transition-colors"
        style={open ? { background: "#161b22", borderLeft: `2px solid ${s.color}` } : undefined}
      >
        <span className="mt-0.5 shrink-0 text-[#484f58]">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="mt-0.5 shrink-0"><SevIcon severity={f.severity} size={13} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-[#e6edf3] leading-snug">{f.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {f.file && (
              <span className="flex items-center gap-1 text-[11px] text-[#8b949e] font-mono">
                <FileCode2 size={10} /> {f.file}
              </span>
            )}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}
            >
              {f.category}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-mono text-[#484f58] hidden sm:block">{f.repo}</span>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pt-0 pb-3 ml-[44px] space-y-3 bg-[#161b22]" onClick={e => e.stopPropagation()}>
          <p className="text-xs text-[#8b949e] leading-relaxed">{f.detail}</p>

          {f.fix && (
            <div className="rounded border border-[#21262d] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#1c2128] border-b border-[#21262d]">
                <span className="text-[10px] font-mono text-[#484f58]">fix</span>
                <button
                  onClick={copyFix}
                  className="flex items-center gap-1 text-[10px] text-[#8b949e] hover:text-[#f0f6fc] transition-colors"
                >
                  {copied ? <CheckCheck size={10} className="text-[#3fb950]" /> : <Copy size={10} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="px-3 py-2.5 text-[11px] font-mono text-[#3fb950] bg-[#0d1117] overflow-x-auto whitespace-pre leading-relaxed">
                {f.fix}
              </pre>
            </div>
          )}

          {/* Create PR row */}
          <div className="flex items-center gap-2 flex-wrap">
            {prState !== "done" && (
              <button
                onClick={createPR}
                disabled={prState === "loading"}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-[#238636]/50 text-[#3fb950] hover:bg-[#238636]/10 disabled:opacity-50 transition-colors"
              >
                {prState === "loading"
                  ? <><Loader size={10} className="animate-spin" /> Creating PR…</>
                  : <><GitPullRequest size={10} /> Create PR</>
                }
              </button>
            )}
            {prState === "done" && prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-[#388bfd]/40 text-[#388bfd] hover:bg-[#388bfd]/10 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <GitPullRequest size={10} /> View PR
              </a>
            )}
            {prState === "done" && !prUrl && (
              <span className="text-[10px] text-[#3fb950] flex items-center gap-1">
                <CheckCheck size={10} /> Branch pushed
              </span>
            )}
            {prNote && (
              <span className={`text-[10px] ${prState === "error" ? "text-[#f85149]" : "text-[#484f58]"}`}>
                {prNote}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scan sessions (VSCode-style tabs, persisted to localStorage) ──────────────

interface ScanSession {
  id: string;
  ts: number;                       // last updated
  repos: LocalRepo[];               // the working set for this tab
  findings: RepoFinding[] | null;   // null = draft (not scanned yet)
}

const SESSIONS_KEY = "opsradar_github_sessions";
const ACTIVE_KEY   = "opsradar_github_active";

function loadSessions(): ScanSession[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]"); } catch { return []; }
}

function persistSessions(sessions: ScanSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 30)));
}

function newDraft(): ScanSession {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    repos: [],
    findings: null,
  };
}

function tabLabel(s: ScanSession): string {
  if (s.repos.length === 0) return "New scan";
  if (s.repos.length === 1) return s.repos[0].name;
  return `${s.repos[0].name} +${s.repos.length - 1}`;
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function GitHubPage() {
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  const [pathInput, setPathInput]       = useState("");
  const [addError, setAddError]         = useState<string | null>(null);
  const [addLoading, setAddLoading]     = useState(false);

  const [discoverRoot, setDiscoverRoot]         = useState("");
  const [discovered, setDiscovered]             = useState<LocalRepo[]>([]);
  const [discoverLoading, setDiscoverLoading]   = useState(false);
  const [discoverOpen, setDiscoverOpen]         = useState(false);

  const [scanning, setScanning]     = useState(false);
  const [scanError, setScanError]   = useState<string | null>(null);

  // filters
  const [sevFilter, setSevFilter]   = useState<string>(""); // "" = all
  const [repoFilter, setRepoFilter] = useState<string>(""); // "" = all
  const [groupBy, setGroupBy]       = useState<"severity" | "file" | "category">("severity");

  // ── Hydrate sessions from localStorage on mount ──────────────────────────
  useEffect(() => {
    const loaded = loadSessions();
    if (loaded.length === 0) {
      const d = newDraft();
      setSessions([d]);
      setActiveId(d.id);
    } else {
      const savedActive = localStorage.getItem(ACTIVE_KEY) ?? "";
      setSessions(loaded);
      setActiveId(loaded.some(s => s.id === savedActive) ? savedActive : loaded[0].id);
    }
    setHydrated(true);
  }, []);

  // ── Persist on change ────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    persistSessions(sessions);
    localStorage.setItem(ACTIVE_KEY, activeId);
  }, [sessions, activeId, hydrated]);

  const active      = sessions.find(s => s.id === activeId) ?? null;
  const addedRepos  = active?.repos ?? [];
  const findings    = active?.findings ?? null;

  const updateActive = useCallback(
    (patch: (s: ScanSession) => Partial<ScanSession>) => {
      setSessions(prev => prev.map(s => (s.id === activeId ? { ...s, ...patch(s) } : s)));
    },
    [activeId],
  );

  function selectTab(id: string) {
    setActiveId(id);
    setSevFilter("");
    setRepoFilter("");
    setScanError(null);
  }

  function openNewTab() {
    const d = newDraft();
    setSessions(prev => [...prev, d]);
    setActiveId(d.id);
    setSevFilter(""); setRepoFilter(""); setScanError(null);
  }

  function closeTab(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const idx  = sessions.findIndex(s => s.id === id);
    const next = sessions.filter(s => s.id !== id);
    if (next.length === 0) {
      const d = newDraft();
      setSessions([d]); setActiveId(d.id);
      return;
    }
    setSessions(next);
    if (id === activeId) {
      setActiveId(next[Math.min(idx, next.length - 1)].id);
      setSevFilter(""); setRepoFilter("");
    }
  }

  async function addRepo() {
    const path = pathInput.trim();
    if (!path || !active) return;
    if (addedRepos.find(r => r.path === path)) { setAddError("Already added."); return; }
    setAddLoading(true); setAddError(null);
    try {
      const repos = await listLocalRepos(path);
      const match = repos.find(r => r.path === path) ?? repos[0];
      if (!match) { setAddError("No git repo found at this path."); return; }
      updateActive(s => ({ repos: [...s.repos, match] }));
      setPathInput("");
    } catch { setAddError("Could not read path."); }
    finally { setAddLoading(false); }
  }

  async function discoverRepos() {
    setDiscoverLoading(true);
    try {
      const repos = await listLocalRepos(discoverRoot.trim() || undefined);
      setDiscovered(repos);
    } catch { /* ignore */ }
    finally { setDiscoverLoading(false); }
  }

  async function handleScan() {
    if (!active || addedRepos.length === 0) return;
    setScanning(true); setScanError(null);
    try {
      const result = await scanGitHubRepos(addedRepos.map(r => r.path));
      updateActive(() => ({ findings: result.findings ?? [], ts: Date.now() }));
    } catch (e) { setScanError(String(e)); }
    finally { setScanning(false); }
  }

  // ── Derived display data ────────────────────────────────────────────────

  const displayed = (findings ?? []).filter(f => {
    if (sevFilter && f.severity !== sevFilter) return false;
    if (repoFilter && f.repo !== repoFilter) return false;
    return true;
  });

  const counts = SEV_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = (findings ?? []).filter(f => f.severity === s).length;
    return acc;
  }, {});

  // Map repo name → local absolute path (for PR creation)
  const repoPaths = addedRepos.reduce<Record<string, string>>((acc, r) => {
    acc[r.name] = r.path;
    return acc;
  }, {});

  // Group displayed findings
  function groupKey(f: RepoFinding) {
    if (groupBy === "file") return f.file || "(root)";
    if (groupBy === "category") return f.category || "Other";
    return f.severity;
  }

  const groups = displayed.reduce<Record<string, RepoFinding[]>>((acc, f) => {
    const k = groupKey(f);
    acc[k] = acc[k] ?? [];
    acc[k].push(f);
    return acc;
  }, {});

  const groupOrder = groupBy === "severity"
    ? SEV_ORDER.filter(s => groups[s])
    : Object.keys(groups).sort();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Tab bar (VSCode-style) ── */}
      <div className="shrink-0 flex items-stretch bg-[#010409] border-b border-[#21262d] overflow-x-auto">
        {sessions.map(s => {
          const isActive = s.id === activeId;
          const count    = s.findings?.length ?? null;
          const crit     = (s.findings ?? []).filter(f => f.severity === "critical").length;
          return (
            <div
              key={s.id}
              onClick={() => selectTab(s.id)}
              role="button"
              className={`group relative flex items-center gap-2 pl-3 pr-2 h-9 shrink-0 cursor-pointer border-r border-[#21262d] whitespace-nowrap transition-colors ${
                isActive ? "bg-[#0d1117] text-[#f0f6fc]" : "bg-[#010409] text-[#8b949e] hover:bg-[#0d1117]/60"
              }`}
            >
              {isActive && <span className="absolute top-0 left-0 right-0 h-[2px] bg-[#388bfd]" />}
              <GitBranch size={11} className={isActive ? "text-[#388bfd]" : "text-[#484f58]"} />
              <span className="text-[12px] max-w-[150px] truncate">{tabLabel(s)}</span>
              {s.findings === null ? (
                <span className="text-[9px] text-[#484f58] italic">draft</span>
              ) : count !== null && (
                <span className={`text-[10px] font-mono ${crit > 0 ? "text-[#f85149]" : "text-[#484f58]"}`}>
                  {count}
                </span>
              )}
              <button
                onClick={e => closeTab(s.id, e)}
                className="ml-0.5 w-4 h-4 flex items-center justify-center rounded text-[#484f58] hover:text-[#f0f6fc] hover:bg-[#30363d] opacity-0 group-hover:opacity-100 transition-opacity"
                title="Close tab"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
        <button
          onClick={openNewTab}
          title="New scan"
          className="flex items-center justify-center w-9 h-9 shrink-0 text-[#484f58] hover:text-[#f0f6fc] hover:bg-[#0d1117] transition-colors"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* ── Top bar ── */}
      <div className="shrink-0 flex items-center gap-3 flex-wrap px-5 py-3 border-b border-[#21262d] bg-[#0d1117]">
        <Layers size={14} className="text-[#8b949e]" />
        <span className="text-sm font-semibold text-[#f0f6fc]">GitHub Analysis</span>
        <span className="text-[#21262d]">|</span>
        <span className="text-xs text-[#8b949e]">{addedRepos.length} repo{addedRepos.length !== 1 ? "s" : ""}</span>
        {findings !== null && (
          <span className="text-xs text-[#8b949e]">· {findings.length} findings</span>
        )}
        <button
          onClick={handleScan}
          disabled={scanning || addedRepos.length === 0}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#388bfd] hover:bg-[#58a6ff] disabled:opacity-50 text-white rounded-md transition-colors font-semibold"
        >
          <Zap size={12} />
          {scanning ? "Scanning…" : findings !== null ? "Rescan" : "Scan with Bob"}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Left: repo management ── */}
        <aside className="w-64 shrink-0 border-r border-[#21262d] flex flex-col bg-[#0d1117] overflow-hidden">
          <div className="shrink-0 px-3 py-2.5 border-b border-[#21262d]">
            <p className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest">Repositories</p>
          </div>

          {/* Added repos list */}
          <div className="flex-1 overflow-y-auto">
            {addedRepos.length === 0 && (
              <p className="text-[11px] text-[#484f58] px-3 py-4">No repos added yet.</p>
            )}
            {addedRepos.map(repo => {
              const repoFindings = (findings ?? []).filter(f => f.repo === repo.name);
              const critCount = repoFindings.filter(f => f.severity === "critical").length;
              const highCount = repoFindings.filter(f => f.severity === "high").length;
              const isFiltered = repoFilter === repo.name;
              return (
                <div
                  key={repo.path}
                  onClick={() => setRepoFilter(isFiltered ? "" : repo.name)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-l-2 ${
                    isFiltered
                      ? "bg-[#161b22] border-[#388bfd]"
                      : "border-transparent hover:bg-[#161b22]"
                  }`}
                >
                  <FolderOpen size={12} className="text-[#8b949e] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#f0f6fc] font-medium truncate">{repo.name}</p>
                    <p className="text-[9px] font-mono text-[#484f58] flex items-center gap-1">
                      <GitBranch size={8} /> {repo.branch || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {critCount > 0 && (
                      <span className="text-[10px] font-mono text-[#f85149]">{critCount}</span>
                    )}
                    {highCount > 0 && (
                      <span className="text-[10px] font-mono text-[#e3b341]">{highCount}</span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); updateActive(s => ({ repos: s.repos.filter(r => r.path !== repo.path) })); }}
                      className="text-[#484f58] hover:text-[#f85149] transition-colors ml-1"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add repo input */}
          <div className="shrink-0 border-t border-[#21262d] p-2 space-y-1.5">
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="/path/to/repo"
                value={pathInput}
                onChange={e => { setPathInput(e.target.value); setAddError(null); }}
                onKeyDown={e => e.key === "Enter" && addRepo()}
                className="flex-1 text-[11px] bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] font-mono min-w-0"
              />
              <button
                onClick={addRepo}
                disabled={addLoading || !pathInput.trim()}
                className="shrink-0 px-2 py-1.5 bg-[#21262d] hover:bg-[#30363d] disabled:opacity-50 text-[#8b949e] hover:text-[#f0f6fc] rounded border border-[#30363d] transition-colors"
                title="Add repo"
              >
                <Plus size={12} />
              </button>
            </div>
            {addError && <p className="text-[10px] text-[#f85149]">{addError}</p>}

            {/* Discover toggle */}
            <button
              onClick={() => { setDiscoverOpen(o => !o); if (!discoverOpen && !discovered.length) discoverRepos(); }}
              className="w-full flex items-center gap-1.5 text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors py-0.5"
            >
              <FolderSearch size={10} />
              Auto-discover
              {discoverOpen ? <ChevronDown size={9} className="ml-auto" /> : <ChevronRight size={9} className="ml-auto" />}
            </button>
          </div>

          {/* Discover panel */}
          {discoverOpen && (
            <div className="shrink-0 border-t border-[#21262d] bg-[#161b22]">
              <div className="flex gap-1 px-2 py-2">
                <input
                  type="text"
                  placeholder="Root path…"
                  value={discoverRoot}
                  onChange={e => setDiscoverRoot(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && discoverRepos()}
                  className="flex-1 text-[10px] bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] font-mono min-w-0"
                />
                <button onClick={discoverRepos} disabled={discoverLoading}
                  className="text-[10px] px-2 py-1 border border-[#30363d] text-[#8b949e] rounded hover:border-[#388bfd]/40 disabled:opacity-50 transition-colors">
                  {discoverLoading ? "…" : "Scan"}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {discovered.map(repo => {
                  const already = !!addedRepos.find(r => r.path === repo.path);
                  return (
                    <div key={repo.path} className="flex items-center gap-2 px-2 py-1.5 border-t border-[#21262d] hover:bg-[#0d1117]">
                      <FolderOpen size={10} className="text-[#484f58] shrink-0" />
                      <span className="text-[10px] text-[#8b949e] flex-1 truncate">{repo.name}</span>
                      <button
                        onClick={() => { if (!already) updateActive(s => ({ repos: [...s.repos, repo] })); }}
                        disabled={already}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${already ? "border-[#30363d] text-[#484f58]" : "border-[#238636]/50 text-[#3fb950] hover:bg-[#238636]/10"}`}
                      >
                        {already ? "Added" : "+"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* ── Right: Problems panel ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Problems bar */}
          {findings !== null && (
            <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-[#21262d] bg-[#161b22] flex-wrap">
              {/* Severity filters */}
              <div className="flex items-center gap-1 flex-1 flex-wrap">
                {["critical","high","medium","low","info"].map(s => {
                  if (!counts[s]) return null;
                  const sv = SEV[s];
                  return (
                    <button
                      key={s}
                      onClick={() => setSevFilter(p => p === s ? "" : s)}
                      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors"
                      style={{
                        color: sevFilter === s ? sv.color : "#8b949e",
                        borderColor: sevFilter === s ? `${sv.color}50` : "#30363d",
                        background: sevFilter === s ? `color-mix(in srgb, ${sv.color} 12%, transparent)` : "transparent",
                      }}
                    >
                      <sv.Icon size={10} />
                      {counts[s]}
                    </button>
                  );
                })}
              </div>

              {/* Group-by toggle */}
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-[#484f58]">Group by</span>
                {(["severity","file","category"] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={`px-1.5 py-0.5 rounded border transition-colors ${
                      groupBy === g
                        ? "border-[#388bfd]/40 bg-[#388bfd]/10 text-[#388bfd]"
                        : "border-[#30363d] text-[#484f58] hover:text-[#8b949e]"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Findings list */}
          <div className="flex-1 overflow-y-auto">
            {scanError && (
              <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/8 border border-[#f85149]/20 rounded-md m-4 px-3 py-2">
                <AlertCircle size={13} /> {scanError}
              </div>
            )}

            {scanning && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-2">
                  <div className="text-xs text-[#8b949e] animate-pulse">Bob is analyzing repositories…</div>
                  <div className="text-[10px] text-[#484f58]">Checking CI/CD, security, dependencies</div>
                </div>
              </div>
            )}

            {!scanning && findings === null && !scanError && (
              <div className="flex items-center justify-center h-full text-center px-8">
                <div className="space-y-3">
                  <ShieldAlert size={28} className="text-[#21262d] mx-auto" />
                  <p className="text-sm text-[#484f58]">Add repos on the left, then Scan with Bob</p>
                  <p className="text-[11px] text-[#30363d]">Checks CI/CD · Security · Code quality · Dependencies</p>
                </div>
              </div>
            )}

            {!scanning && findings !== null && displayed.length === 0 && (
              <div className="flex items-center justify-center h-full text-xs text-[#484f58]">
                No findings match the current filter.
              </div>
            )}

            {!scanning && findings !== null && groupOrder.map(group => (
              <GroupSection key={group} group={group} findings={groups[group]} groupBy={groupBy} repoPaths={repoPaths} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupSection({
  group, findings, groupBy, repoPaths,
}: {
  group: string;
  findings: RepoFinding[];
  groupBy: "severity" | "file" | "category";
  repoPaths: Record<string, string>; // repo name → absolute path
}) {
  const [open, setOpen] = useState(true);
  const s = SEV[group];

  return (
    <div className="border-b border-[#21262d] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 bg-[#0d1117] hover:bg-[#0f1319] transition-colors text-left border-b border-[#21262d]"
      >
        {open ? <ChevronDown size={11} className="text-[#484f58]" /> : <ChevronRight size={11} className="text-[#484f58]" />}
        {groupBy === "severity" && s
          ? <span style={{ color: s.color, display: "inline-flex" }}><s.Icon size={12} /></span>
          : groupBy === "file"
            ? <FileCode2 size={11} className="text-[#8b949e]" />
            : <Layers size={11} className="text-[#8b949e]" />
        }
        <span
          className="text-[12px] font-semibold"
          style={groupBy === "severity" && s ? { color: s.color } : { color: "#c9d1d9" }}
        >
          {group}
        </span>
        <span className="ml-1 text-[10px] text-[#484f58] font-mono">{findings.length}</span>
      </button>

      {open && findings.map((f, i) => (
        <FindingRow key={i} f={f} repoPath={repoPaths[f.repo] ?? ""} />
      ))}
    </div>
  );
}
