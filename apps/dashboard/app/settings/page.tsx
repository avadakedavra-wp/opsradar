"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Bot, GitBranch, Shield, Server,
  Eye, EyeOff, CheckCircle, XCircle, Loader,
  ExternalLink, Info, Lock, Copy, RefreshCw,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type SettingEntry = { configured: boolean; preview: string; value: string; sensitive: boolean };
type Settings = Record<string, SettingEntry>;

async function fetchSettings(): Promise<Settings> {
  const res = await fetch(`${API_URL}/settings`);
  const data = await res.json();
  return data.settings ?? {};
}

async function saveSettings(payload: Record<string, string>) {
  const res = await fetch(`${API_URL}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "save failed");
}

async function testKey(key: string, value: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_URL}/settings/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  return res.json();
}

// ── Generic ServiceCard ───────────────────────────────────────────────────────

type TestState = "idle" | "testing" | "ok" | "fail";

interface Field {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  sensitive: boolean;
  testable: boolean;
}

function ServiceCard({
  icon: Icon, iconColor, name, description, fields, initialValues, onSaved,
}: {
  icon: React.FC<{ size?: number; className?: string }>;
  iconColor: string;
  name: string;
  description: string;
  fields: Field[];
  initialValues: Settings;
  onSaved: () => void;
}) {
  const [values, setValues]     = useState<Record<string, string>>({});
  const [shown, setShown]       = useState<Record<string, boolean>>({});
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saveErr, setSaveErr]   = useState("");
  const [testStates, setTS]     = useState<Record<string, TestState>>({});
  const [testMsgs, setTM]       = useState<Record<string, string>>({});

  const isConfigured = fields.every(f => initialValues[f.key]?.configured || (values[f.key] ?? "").trim() !== "");
  const isBrandNew   = fields.every(f => !initialValues[f.key]?.configured);

  function displayValue(f: Field) {
    const entered = values[f.key];
    if (entered !== undefined) return entered;
    const init = initialValues[f.key];
    if (!init?.configured) return "";
    return f.sensitive ? "" : (init.value ?? "");
  }

  function placeholderFor(f: Field) {
    const init = initialValues[f.key];
    if (init?.configured && f.sensitive && !values[f.key]) return init.preview || "••••••••••••";
    return f.placeholder;
  }

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveErr("");
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        const v = (values[f.key] ?? "").trim();
        if (v) payload[f.key] = v;
      }
      if (Object.keys(payload).length === 0) { setSaving(false); return; }
      await saveSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setValues({});
      onSaved();
    } catch (e: unknown) {
      setSaveErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(f: Field) {
    const v = (values[f.key] ?? "").trim() || (initialValues[f.key]?.value ?? "");
    setTS(p => ({ ...p, [f.key]: "testing" }));
    setTM(p => ({ ...p, [f.key]: "" }));
    const res = await testKey(f.key, v);
    setTS(p => ({ ...p, [f.key]: res.ok ? "ok" : "fail" }));
    setTM(p => ({ ...p, [f.key]: res.message }));
  }

  const hasChanges = fields.some(f => (values[f.key] ?? "").trim() !== "");

  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#21262d]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
             style={{ background: `${iconColor}15`, border: `1px solid ${iconColor}30` }}>
          <span style={{ color: iconColor, display: "inline-flex" }}><Icon size={16} /></span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold text-[#f0f6fc]">{name}</h2>
          <p className="text-[11px] text-[#8b949e] mt-0.5">{description}</p>
        </div>
        <div className="shrink-0">
          {isConfigured && !isBrandNew ? (
            <span className="flex items-center gap-1.5 text-[11px] text-[#3fb950] bg-[#3fb950]/10 border border-[#3fb950]/25 rounded-full px-2.5 py-0.5 font-medium">
              <CheckCircle size={10} /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-[#484f58] bg-[#21262d] border border-[#30363d] rounded-full px-2.5 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#484f58]" /> Not configured
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {fields.map(f => {
          const ts  = testStates[f.key] ?? "idle";
          const msg = testMsgs[f.key] ?? "";
          return (
            <div key={f.key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-[#8b949e] uppercase tracking-wider">{f.label}</label>
                {f.hint && (
                  <span className="text-[10px] text-[#484f58] flex items-center gap-1">
                    <Info size={9} /> {f.hint}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={f.sensitive && !shown[f.key] ? "password" : "text"}
                    value={displayValue(f)}
                    placeholder={placeholderFor(f)}
                    onChange={e => setValues(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-[13px] text-[#f0f6fc] placeholder:text-[#30363d] focus:outline-none focus:border-[#388bfd] transition-colors font-mono pr-8"
                  />
                  {f.sensitive && (
                    <button type="button" onClick={() => setShown(p => ({ ...p, [f.key]: !p[f.key] }))}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]">
                      {shown[f.key] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  )}
                </div>
                {f.testable && (
                  <button onClick={() => handleTest(f)} disabled={ts === "testing"}
                          className="shrink-0 flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-lg border border-[#30363d] text-[#8b949e] hover:border-[#388bfd]/40 hover:text-[#388bfd] disabled:opacity-50 transition-colors whitespace-nowrap">
                    {ts === "testing" && <Loader size={11} className="animate-spin" />}
                    {ts === "ok"      && <CheckCircle size={11} className="text-[#3fb950]" />}
                    {ts === "fail"    && <XCircle size={11} className="text-[#f85149]" />}
                    Test
                  </button>
                )}
              </div>
              {msg && (
                <p className={`mt-1.5 text-[11px] flex items-center gap-1 ${
                  ts === "ok" ? "text-[#3fb950]" : ts === "fail" ? "text-[#f85149]" : "text-[#8b949e]"
                }`}>
                  {ts === "ok"   && <CheckCircle size={10} />}
                  {ts === "fail" && <XCircle size={10} />}
                  {msg}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 pb-4 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving || !hasChanges}
                className="flex items-center gap-2 text-[12px] px-4 py-2 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white rounded-lg transition-colors font-medium">
          {saving && <Loader size={11} className="animate-spin" />}
          {saving ? "Saving…" : "Save"}
        </button>
        {saved    && <span className="text-[11px] text-[#3fb950] flex items-center gap-1"><CheckCircle size={11} /> Saved</span>}
        {saveErr  && <span className="text-[11px] text-[#f85149]">{saveErr}</span>}
      </div>
    </div>
  );
}

// ── GitHub OAuth App Card ─────────────────────────────────────────────────────

function StepNum({ n, active }: { n: number; active: boolean }) {
  return (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
      active
        ? "bg-[#388bfd]/15 border border-[#388bfd]/30 text-[#388bfd]"
        : "bg-[#21262d] border border-[#30363d] text-[#484f58]"
    }`}>
      {n}
    </div>
  );
}

function GitHubOAuthCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [clientId, setClientId]       = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [connecting, setConnecting]   = useState(false);
  const [copied, setCopied]           = useState(false);
  const [alert, setAlert]             = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const hasClientId     = settings["GITHUB_CLIENT_ID"]?.configured;
  const hasClientSecret = settings["GITHUB_CLIENT_SECRET"]?.configured;
  const hasToken        = settings["GITHUB_TOKEN"]?.configured;
  const credentialsReady = hasClientId && hasClientSecret;

  // Pick up OAuth callback result from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gh = params.get("github");
    if (gh === "connected") {
      const login = params.get("login");
      setAlert({ type: "ok", text: login ? `Connected as @${login}` : "GitHub connected" });
      window.history.replaceState({}, "", "/settings");
      onSaved();
    } else if (gh === "error") {
      const msg = params.get("msg") ?? "Connection failed";
      setAlert({ type: "error", text: decodeURIComponent(msg) });
      window.history.replaceState({}, "", "/settings");
    }
  }, [onSaved]);

  async function handleSaveCredentials() {
    const payload: Record<string, string> = {};
    if (clientId.trim())     payload["GITHUB_CLIENT_ID"]     = clientId.trim();
    if (clientSecret.trim()) payload["GITHUB_CLIENT_SECRET"] = clientSecret.trim();
    if (Object.keys(payload).length === 0) return;
    setSaving(true);
    try {
      await saveSettings(payload);
      setClientId(""); setClientSecret("");
      onSaved();
    } catch (e: unknown) {
      setAlert({ type: "error", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setAlert(null);
    try {
      const res  = await fetch(`${API_URL}/github/oauth/start`);
      const data = await res.json();
      if (data.error) { setAlert({ type: "error", text: data.error }); return; }
      window.location.href = data.url;
    } catch (e: unknown) {
      setAlert({ type: "error", text: String(e) });
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await saveSettings({ GITHUB_TOKEN: "" });
    setAlert(null);
    onSaved();
  }

  function copyCallback() {
    navigator.clipboard.writeText("http://localhost:8080/github/oauth/callback");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const hasChanges = clientId.trim() !== "" || clientSecret.trim() !== "";

  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#21262d]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#3fb950]/10 border border-[#3fb950]/30 shrink-0">
          <span style={{ color: "#3fb950", display: "inline-flex" }}><GitBranch size={16} /></span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold text-[#f0f6fc]">GitHub</h2>
          <p className="text-[11px] text-[#8b949e] mt-0.5">Auto-fix PRs, repo scanning, workflow analysis</p>
        </div>
        <div className="shrink-0">
          {hasToken ? (
            <span className="flex items-center gap-1.5 text-[11px] text-[#3fb950] bg-[#3fb950]/10 border border-[#3fb950]/25 rounded-full px-2.5 py-0.5 font-medium">
              <CheckCircle size={10} /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-[#484f58] bg-[#21262d] border border-[#30363d] rounded-full px-2.5 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#484f58]" /> Not connected
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-5 space-y-6">

        {/* Step 1 — Create OAuth App */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <StepNum n={1} active />
            <span className="text-[12px] font-semibold text-[#f0f6fc]">Create a GitHub OAuth App</span>
          </div>
          <div className="ml-[29px] space-y-2.5">
            <p className="text-[11px] text-[#8b949e]">
              Go to{" "}
              <a href="https://github.com/settings/applications/new" target="_blank" rel="noopener noreferrer"
                 className="text-[#388bfd] hover:underline inline-flex items-center gap-0.5">
                github.com/settings/applications/new <ExternalLink size={9} />
              </a>{" "}
              and fill in:
            </p>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 space-y-2 text-[11px] font-mono">
              <div className="flex">
                <span className="text-[#484f58] w-36 shrink-0">Application name</span>
                <span className="text-[#f0f6fc]">OpsRadar</span>
              </div>
              <div className="flex">
                <span className="text-[#484f58] w-36 shrink-0">Homepage URL</span>
                <span className="text-[#f0f6fc]">http://localhost:3000</span>
              </div>
              <div className="flex items-center">
                <span className="text-[#484f58] w-36 shrink-0">Callback URL</span>
                <span className="text-[#3fb950] flex-1">http://localhost:8080/github/oauth/callback</span>
                <button onClick={copyCallback}
                        className="ml-2 text-[#484f58] hover:text-[#8b949e] transition-colors flex items-center gap-1 text-[10px]"
                        title="Copy">
                  {copied ? <CheckCircle size={10} className="text-[#3fb950]" /> : <Copy size={10} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 — Paste credentials */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <StepNum n={2} active />
            <span className="text-[12px] font-semibold text-[#f0f6fc]">Paste Client ID and Secret</span>
          </div>
          <div className="ml-[29px] space-y-3">
            {/* Client ID */}
            <div>
              <label className="text-[11px] font-medium text-[#8b949e] uppercase tracking-wider block mb-1.5">
                Client ID
              </label>
              <input
                type="text"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder={hasClientId ? (settings["GITHUB_CLIENT_ID"]?.value || "Ov23li…") : "Paste Client ID"}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-[13px] text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] transition-colors font-mono"
              />
              {hasClientId && !clientId && (
                <p className="mt-1 text-[10px] text-[#3fb950] flex items-center gap-1">
                  <CheckCircle size={9} /> Saved
                </p>
              )}
            </div>
            {/* Client Secret */}
            <div>
              <label className="text-[11px] font-medium text-[#8b949e] uppercase tracking-wider block mb-1.5">
                Client Secret
              </label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder={hasClientSecret ? (settings["GITHUB_CLIENT_SECRET"]?.preview || "••••••••••••") : "Paste Client Secret"}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-[13px] text-[#f0f6fc] placeholder:text-[#484f58] focus:outline-none focus:border-[#388bfd] transition-colors font-mono pr-8"
                />
                <button type="button" onClick={() => setShowSecret(s => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]">
                  {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              {hasClientSecret && !clientSecret && (
                <p className="mt-1 text-[10px] text-[#3fb950] flex items-center gap-1">
                  <CheckCircle size={9} /> Saved
                </p>
              )}
            </div>
            {hasChanges && (
              <button onClick={handleSaveCredentials} disabled={saving}
                      className="flex items-center gap-2 text-[12px] px-4 py-2 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white rounded-lg transition-colors font-medium">
                {saving && <Loader size={11} className="animate-spin" />}
                {saving ? "Saving…" : "Save credentials"}
              </button>
            )}
          </div>
        </div>

        {/* Step 3 — Authorize */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <StepNum n={3} active={!!credentialsReady} />
            <span className={`text-[12px] font-semibold ${credentialsReady ? "text-[#f0f6fc]" : "text-[#484f58]"}`}>
              Connect with GitHub
            </span>
          </div>
          <div className="ml-[29px] space-y-2">
            {hasToken ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-[12px] text-[#3fb950]">
                  <CheckCircle size={13} />
                  {alert?.type === "ok" ? alert.text : "GitHub connected"}
                </div>
                <button onClick={handleDisconnect}
                        className="text-[11px] text-[#8b949e] hover:text-[#f85149] flex items-center gap-1 transition-colors">
                  <RefreshCw size={10} /> Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!credentialsReady || connecting}
                className="flex items-center gap-2 text-[12px] px-4 py-2 rounded-lg border border-[#30363d] bg-[#21262d] text-[#f0f6fc] hover:border-[#3fb950]/50 hover:bg-[#3fb950]/8 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {connecting
                  ? <><Loader size={12} className="animate-spin" /> Connecting…</>
                  : <><GitBranch size={12} /> Connect with GitHub</>
                }
              </button>
            )}
            {!credentialsReady && !hasToken && (
              <p className="text-[10px] text-[#484f58]">Complete steps 1 and 2 first</p>
            )}
            {alert?.type === "error" && (
              <p className="text-[11px] text-[#f85149] flex items-center gap-1">
                <XCircle size={10} /> {alert.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await fetchSettings();
      setSettings(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const SERVICES = [
    {
      icon: Bot,
      iconColor: "#a78bfa",
      name: "Claude AI",
      description: "Powers Bob chat, auto-analysis, and finding explanations",
      fields: [
        { key: "ANTHROPIC_API_KEY", label: "API Key", placeholder: "sk-ant-api03-…", hint: "from console.anthropic.com", sensitive: true, testable: true },
      ],
    },
    {
      icon: Shield,
      iconColor: "#e3b341",
      name: "API Security",
      description: "Optional key that gates access to the OpsRadar API",
      fields: [
        { key: "OPS_RADAR_API_KEY", label: "API Key", placeholder: "any-secret-string", hint: "optional — leave blank for open access", sensitive: true, testable: false },
      ],
    },
    {
      icon: Server,
      iconColor: "#388bfd",
      name: "Kubernetes",
      description: "Custom kubeconfig path — defaults to ~/.kube/config",
      fields: [
        { key: "KUBECONFIG", label: "Kubeconfig Path", placeholder: "~/.kube/config", hint: "absolute path or leave blank for default", sensitive: false, testable: false },
      ],
    },
  ];

  const essentialConfigured =
    settings["ANTHROPIC_API_KEY"]?.configured && settings["GITHUB_TOKEN"]?.configured;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-[#8b949e]" />
            <h1 className="text-[18px] font-semibold text-[#f0f6fc]">Connect your services</h1>
          </div>
          <p className="text-[13px] text-[#8b949e] leading-relaxed">
            Credentials are stored in{" "}
            <code className="text-[11px] bg-[#21262d] border border-[#30363d] rounded px-1.5 py-0.5 font-mono text-[#8b949e]">
              ~/.opsradar/.env
            </code>{" "}
            on this machine only — never sent anywhere except the service you are connecting to.
          </p>
        </div>

        {/* All-done banner */}
        {!loading && essentialConfigured && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#3fb950]/8 border border-[#3fb950]/20">
            <CheckCircle size={14} className="text-[#3fb950] shrink-0" />
            <p className="text-[12px] text-[#3fb950]">
              All essential services connected — OpsRadar is fully operational.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-[#484f58] py-8 justify-center">
            <Loader size={13} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Claude AI first */}
            <ServiceCard
              key="claude"
              icon={SERVICES[0].icon}
              iconColor={SERVICES[0].iconColor}
              name={SERVICES[0].name}
              description={SERVICES[0].description}
              fields={SERVICES[0].fields}
              initialValues={Object.fromEntries(
                SERVICES[0].fields.map(f => [f.key, settings[f.key] ?? { configured: false, preview: "", value: "", sensitive: f.sensitive }])
              )}
              onSaved={load}
            />

            {/* GitHub OAuth App */}
            <GitHubOAuthCard settings={settings} onSaved={load} />

            {/* The rest */}
            {SERVICES.slice(1).map(svc => (
              <ServiceCard
                key={svc.name}
                icon={svc.icon}
                iconColor={svc.iconColor}
                name={svc.name}
                description={svc.description}
                fields={svc.fields}
                initialValues={Object.fromEntries(
                  svc.fields.map(f => [f.key, settings[f.key] ?? { configured: false, preview: "", value: "", sensitive: f.sensitive }])
                )}
                onSaved={load}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-start gap-2 text-[11px] text-[#484f58] pt-2">
          <Info size={11} className="shrink-0 mt-0.5" />
          <span>
            Changes take effect immediately — no restart needed.{" "}
            <a href="https://github.com/avadakedavra-wp/opsradar#configuration" target="_blank" rel="noopener noreferrer"
               className="text-[#388bfd] hover:underline inline-flex items-center gap-0.5">
              View docs <ExternalLink size={9} />
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}
