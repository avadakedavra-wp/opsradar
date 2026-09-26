"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getRadar, listScans, startScan, scanStatusMeta,
  listPods, askBob,
  Scan, RadarRow, PodInfo,
} from "@/lib/api";
import RadarHeatmap from "@/components/RadarHeatmap";
import Link from "next/link";
import { Zap, ArrowRight, AlertCircle, Send, MessageCircle, Server, ShieldAlert, CheckCircle } from "lucide-react";

interface ChatMsg { role: "user" | "bob"; text: string }

const BOB_STARTERS = [
  "Why are some pods Pending?",
  "Any single-replica deployments at risk?",
  "What's using the most restarts?",
  "How do I improve cluster reliability?",
];

export default function HomePage() {
  const router = useRouter();

  // Scan + radar
  const [radar, setRadar]   = useState<RadarRow[]>([]);
  const [scans, setScans]   = useState<Scan[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Live pods
  const [pods, setPods] = useState<PodInfo[]>([]);

  // Ask Bob chat
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([getRadar(), listScans(), listPods("")])
      .then(([r, s, p]) => { setRadar(r); setScans(s); setPods(p); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleScanNow() {
    setScanning(true);
    setScanError(null);
    try {
      const { scan_id } = await startScan();
      router.push(`/scan/${scan_id}`);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e));
      setScanning(false);
    }
  }

  async function sendBob(text: string) {
    if (!text.trim() || chatLoading) return;
    setMessages(prev => [...prev, { role: "user", text: text.trim() }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const reply = await askBob(text.trim(), { contextType: "cluster" });
      setMessages(prev => [...prev, { role: "bob", text: reply }]);
    } catch (e: unknown) {
      setMessages(prev => [...prev, {
        role: "bob",
        text: `Error: ${e instanceof Error ? e.message : String(e)}`,
      }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleChatSubmit(e: FormEvent) { e.preventDefault(); sendBob(chatInput); }

  // Derived stats
  const running  = pods.filter(p => p.phase === "Running").length;
  const pending  = pods.filter(p => p.phase === "Pending").length;
  const failed   = pods.filter(p => p.phase === "Failed").length;
  const totalFindings = radar.reduce((s, r) => s + r.critical + r.high + r.medium + r.low, 0);
  const criticalCount = radar.reduce((s, r) => s + r.critical, 0);
  const latestScan = scans[0];

  return (
    <main className="overflow-y-auto h-full px-6 py-6 space-y-6 max-w-[1400px]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#f0f6fc] tracking-tight">Dashboard</h1>
          <p className="text-xs text-[#8b949e] mt-0.5">Cluster health · Powered by Bob</p>
        </div>
        <button
          onClick={handleScanNow}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-50"
        >
          <Zap size={12} />
          {scanning ? "Starting…" : "Scan Now"}
        </button>
      </div>

      {scanError && (
        <div className="flex items-center gap-2 text-xs text-[#f85149] bg-[#f85149]/10 border border-[#f85149]/20 rounded-md px-3 py-2">
          <AlertCircle size={13} /> {scanError}
        </div>
      )}

      {/* Live cluster stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { label: "Total Pods",     value: pods.length,   color: "#8b949e" },
          { label: "Running",        value: running,       color: "#3fb950" },
          { label: "Pending",        value: pending,       color: pending  > 0 ? "#e3b341" : "#3fb950" },
          { label: "Failed",         value: failed,        color: failed   > 0 ? "#f85149" : "#3fb950" },
          { label: "Critical Issues",value: criticalCount, color: criticalCount > 0 ? "#f85149" : "#3fb950" },
          { label: "Total Findings", value: totalFindings, color: totalFindings > 0 ? "#e3b341" : "#3fb950" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#161b22] border border-[#21262d] rounded-lg px-3 py-3">
            <div className="text-2xl font-semibold font-mono" style={{ color }}>{value}</div>
            <div className="text-[10px] text-[#8b949e] mt-1 leading-tight">{label}</div>
          </div>
        ))}
      </div>

      {/* Two-column: left = radar + scans, right = Ask Bob */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* LEFT */}
        <div className="space-y-5">

          {/* Namespace Radar */}
          <section className="bg-[#161b22] border border-[#21262d] rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-[#f0f6fc] flex items-center gap-1.5">
                <Server size={12} className="text-[#388bfd]" /> Namespace Radar
              </h2>
              <span className="text-[10px] text-[#484f58]">latest scan · red = critical</span>
            </div>
            <RadarHeatmap data={radar} />
          </section>

          {/* Recent Scans */}
          <section className="bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d]">
              <h2 className="text-xs font-semibold text-[#f0f6fc] flex items-center gap-1.5">
                <ShieldAlert size={12} className="text-[#388bfd]" /> Recent Scans
              </h2>
              <Link href="/history" className="flex items-center gap-1 text-[10px] text-[#388bfd] hover:text-[#58a6ff]">
                All <ArrowRight size={10} />
              </Link>
            </div>
            {scans.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[#8b949e] text-center">
                No scans yet — click Scan Now.
              </div>
            ) : (
              <div className="divide-y divide-[#21262d]">
                {scans.slice(0, 5).map(scan => {
                  const m = scanStatusMeta(scan.status);
                  return (
                    <Link key={scan.id} href={`/scan/${scan.id}`}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-[#1c2128] transition-colors group"
                    >
                      <div className="min-w-0">
                        <span className="text-xs text-[#f0f6fc]">{scan.cluster_name}</span>
                        <span className="text-[10px] text-[#8b949e] ml-2">{new Date(scan.started_at).toLocaleString()}</span>
                      </div>
                      <div className="flex gap-1.5 items-center shrink-0">
                        {scan.critical > 0 && (
                          <span className="text-[10px] text-[#f85149]">{scan.critical}C</span>
                        )}
                        {scan.high > 0 && (
                          <span className="text-[10px] text-[#e3b341]">{scan.high}H</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${m.badgeClass}`}>{m.label}</span>
                        <ArrowRight size={11} className="text-[#484f58] group-hover:text-[#8b949e]" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Latest scan link */}
          {latestScan && (
            <Link href={`/scan/${latestScan.id}`}
              className="flex items-center justify-between bg-[#161b22] border border-[#21262d] rounded-lg px-4 py-3 hover:border-[#388bfd]/40 transition-colors"
            >
              <div>
                <div className="text-xs font-medium text-[#f0f6fc]">
                  <CheckCircle size={11} className="text-[#3fb950] inline mr-1.5" />
                  View Latest Scan
                </div>
                <div className="text-[10px] text-[#8b949e] mt-0.5 ml-4">{latestScan.cluster_name} · {new Date(latestScan.started_at).toLocaleString()}</div>
              </div>
              <ArrowRight size={13} className="text-[#8b949e]" />
            </Link>
          )}
        </div>

        {/* RIGHT — Ask Bob inline */}
        <div className="bg-[#161b22] border border-[#21262d] rounded-lg flex flex-col" style={{ minHeight: 460 }}>
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#21262d] shrink-0">
            <div className="w-6 h-6 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center">
              <MessageCircle size={12} className="text-[#388bfd]" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[#f0f6fc]">Ask Bob</div>
              <div className="text-[10px] text-[#484f58] font-mono">IBM Bob Shell AI · cluster context loaded</div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.length === 0 ? (
              <div className="space-y-2 pt-1">
                <p className="text-[11px] text-[#8b949e] text-center">Ask about your live cluster</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {BOB_STARTERS.map(s => (
                    <button key={s} onClick={() => sendBob(s)}
                      className="text-left text-[11px] px-3 py-2 rounded-md border border-[#21262d] hover:border-[#388bfd]/40 hover:bg-[#1c2128] text-[#8b949e] hover:text-[#f0f6fc] transition-colors leading-snug"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "bob" && (
                  <div className="w-5 h-5 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center shrink-0 mt-0.5">
                    <MessageCircle size={10} className="text-[#388bfd]" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#1f6feb] text-white"
                      : "bg-[#21262d] text-[#e6edf3] border border-[#30363d]"
                  }`}
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex gap-2 items-center">
                <div className="w-5 h-5 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center shrink-0">
                  <MessageCircle size={10} className="text-[#388bfd]" />
                </div>
                <div className="text-[11px] text-[#8b949e] animate-pulse">Thinking…</div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleChatSubmit} className="border-t border-[#21262d] px-3 py-2.5 flex gap-2 shrink-0">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Ask about your cluster…"
              disabled={chatLoading}
              className="flex-1 text-xs bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] disabled:opacity-50 transition-colors"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md disabled:opacity-40 transition-colors"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
