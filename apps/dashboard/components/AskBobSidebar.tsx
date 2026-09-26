"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { askBob } from "@/lib/api";
import { X, Send, MessageCircle, History, Trash2, Plus, Activity, Box } from "lucide-react";

interface Message {
  role: "user" | "bob";
  text: string;
}

interface Session {
  id: string;
  title: string;
  ts: number;
  messages: Message[];
}

interface PodFocus {
  namespace: string;
  pod: string;
  k8sContext?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  podFocus?: PodFocus | null; // when set, Bob reads that pod's logs + events
}

const STARTERS = [
  "Why might pods be in a Pending state?",
  "What does a missing resource limit mean?",
  "How do I fix CrashLoopBackOff?",
  "Explain PodDisruptionBudget",
  "How to check resource usage per namespace?",
  "What causes OOMKilled?",
];

const STORAGE_KEY = "opsradar_bob_sessions";

function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch { return []; }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 20)));
}

// Simple markdown → inline rendering (no dep needed)
function BobMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm text-[#e6edf3] leading-relaxed space-y-1">
      {lines.map((line, i) => {
        // Code block fence — collect multi-line blocks
        if (line.startsWith("```")) {
          return null; // handled below
        }
        // Heading
        if (/^#{1,3} /.test(line)) {
          return <p key={i} className="font-semibold text-[#f0f6fc] mt-2">{line.replace(/^#+\s*/, "")}</p>;
        }
        // Bullet
        if (/^[*\-] /.test(line)) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-[#388bfd] shrink-0">·</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        // Numbered list
        if (/^\d+\. /.test(line)) {
          const num = line.match(/^(\d+)\. /)?.[1];
          return (
            <div key={i} className="flex gap-2">
              <span className="text-[#484f58] shrink-0 w-4 text-right">{num}.</span>
              <span>{renderInline(line.replace(/^\d+\. /, ""))}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // bold **x** and `code`
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i} className="text-[11px] bg-[#0d1117] text-[#3fb950] px-1 rounded font-mono">{part.slice(1, -1)}</code>;
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i} className="text-[#f0f6fc] font-semibold">{part.slice(2, -2)}</strong>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function AskBobSidebar({ open, onClose, podFocus }: Props) {
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load sessions on mount
  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function newSession() {
    setActiveId(null);
    setMessages([]);
    setShowHistory(false);
  }

  function openSession(s: Session) {
    setActiveId(s.id);
    setMessages(s.messages);
    setShowHistory(false);
  }

  function deleteSession(id: string) {
    const next = sessions.filter(s => s.id !== id);
    setSessions(next);
    saveSessions(next);
    if (activeId === id) newSession();
  }

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", text: text.trim() };
    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);
    setInput("");
    setLoading(true);

    try {
      const bobOpts = podFocus
        ? { contextType: "pod", contextId: `${podFocus.namespace}/${podFocus.pod}`, k8sContext: podFocus.k8sContext ?? "" }
        : { contextType: "cluster" };
      const reply = await askBob(userMsg.text, bobOpts);
      const bobMsg: Message = { role: "bob", text: reply };
      const finalMsgs = [...nextMsgs, bobMsg];
      setMessages(finalMsgs);

      // Persist to sessions
      const id = activeId ?? Date.now().toString();
      const title = userMsg.text.slice(0, 48) + (userMsg.text.length > 48 ? "…" : "");
      const session: Session = { id, title, ts: Date.now(), messages: finalMsgs };
      const updated = activeId
        ? sessions.map(s => s.id === id ? session : s)
        : [session, ...sessions];
      setSessions(updated);
      saveSessions(updated);
      if (!activeId) setActiveId(id);
    } catch (e: unknown) {
      setMessages(prev => [...prev, { role: "bob", text: `Error: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden />}

      <aside
        className="fixed top-0 right-0 h-full w-full sm:w-[520px] z-40 flex flex-col bg-[#161b22] border-l border-[#21262d] transition-transform duration-200 ease-out"
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
        aria-label="Ask Bob"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d] shrink-0 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center">
              <MessageCircle size={13} className="text-[#388bfd]" />
            </div>
            <div className="leading-none">
              <div className="text-[13px] font-semibold text-[#f0f6fc]">Ask Bob</div>
              <div className="text-[10px] text-[#484f58] mt-0.5 font-mono flex items-center gap-1">
                {podFocus
                  ? <><Box size={9} className="text-[#388bfd]" />{podFocus.namespace}/{podFocus.pod}</>
                  : <><Activity size={9} className="text-[#3fb950]" />live cluster telemetry</>
                }
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHistory(h => !h)}
              title="Chat history"
              className={`p-1.5 rounded-md transition-colors ${showHistory ? "text-[#388bfd] bg-[#388bfd]/10" : "text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d]"}`}
            >
              <History size={14} />
            </button>
            <button
              onClick={newSession}
              title="New chat"
              className="p-1.5 rounded-md text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* History panel */}
        {showHistory ? (
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            <p className="text-[10px] font-semibold text-[#484f58] uppercase tracking-widest px-1 mb-2">Past Sessions</p>
            {sessions.length === 0 && (
              <p className="text-xs text-[#484f58] px-1">No saved chats yet.</p>
            )}
            {sessions.map(s => (
              <div
                key={s.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors group ${
                  activeId === s.id ? "bg-[#388bfd]/10 border border-[#388bfd]/30" : "hover:bg-[#1c2128]"
                }`}
                onClick={() => openSession(s)}
              >
                <MessageCircle size={11} className="text-[#8b949e] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#e6edf3] truncate">{s.title}</p>
                  <p className="text-[10px] text-[#484f58] font-mono">{new Date(s.ts).toLocaleString()}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-[#8b949e] hover:text-[#f85149] transition-all"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Pod focus banner */}
            {podFocus && (
              <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[#388bfd]/6 border-b border-[#388bfd]/15 text-[11px] text-[#8b949e]">
                <Box size={11} className="text-[#388bfd] shrink-0" />
                <span>Bob will read <span className="font-mono text-[#388bfd]">{podFocus.namespace}/{podFocus.pod}</span> logs &amp; events for every message</span>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
              {messages.length === 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-[11px] text-[#8b949e] text-center">Ask Bob about your cluster</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {STARTERS.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-left text-xs px-3 py-2.5 rounded-md border border-[#21262d] hover:border-[#388bfd]/40 hover:bg-[#1c2128] text-[#8b949e] hover:text-[#f0f6fc] transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "bob" && (
                    <div className="w-6 h-6 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center shrink-0 mt-0.5">
                      <MessageCircle size={11} className="text-[#388bfd]" />
                    </div>
                  )}
                  <div
                    className={`max-w-[88%] rounded-lg px-3 py-2.5 ${
                      msg.role === "user"
                        ? "bg-[#1f6feb] text-white text-sm"
                        : "bg-[#21262d] border border-[#30363d]"
                    }`}
                    style={{ wordBreak: "break-word" }}
                  >
                    {msg.role === "bob" ? <BobMessage text={msg.text} /> : msg.text}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-6 h-6 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center shrink-0 mt-0.5">
                    <MessageCircle size={11} className="text-[#388bfd]" />
                  </div>
                  <div className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-2.5 text-xs text-[#8b949e] space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="animate-pulse">
                        {podFocus ? `Reading ${podFocus.pod} logs` : "Fetching telemetry"}
                      </span>
                      <span className="font-mono">…</span>
                    </div>
                    <div className="text-[10px] text-[#484f58]">
                      {podFocus
                        ? "events + logs → Bob"
                        : "pod status + events + logs → Bob"
                      }
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="border-t border-[#21262d] px-4 py-3 flex gap-2 shrink-0">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about your cluster…"
                disabled={loading}
                className="flex-1 text-sm bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-3 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md disabled:opacity-40 transition-colors"
              >
                <Send size={14} />
              </button>
            </form>
          </>
        )}
      </aside>
    </>
  );
}
