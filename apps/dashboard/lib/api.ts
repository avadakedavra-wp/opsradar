const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

export interface Scan {
  id: string;
  cluster_name: string;
  started_at: string;
  finished_at?: string;
  // "running" | "completed" | "completed_with_errors" | "failed" — see
  // scanStatusMeta below. Never trust "completed" alone to mean success;
  // check failed_tasks too (it's always 0 when status is "completed").
  status: string;
  failed_tasks: number;
  total_tasks: number;
  error_summary?: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// Shared status → display mapping so every view (home, history, timeline)
// renders the same honest distinction between a clean run, a partial
// failure, and a total failure, instead of just "completed" vs everything
// else in gray.
export function scanStatusMeta(status: string): { label: string; badgeClass: string; textClass: string; dotClass: string } {
  switch (status) {
    case "completed":
      return { label: "completed", badgeClass: "bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/25", textClass: "text-[#3fb950]", dotClass: "bg-[#3fb950]" };
    case "completed_with_errors":
      return { label: "with errors", badgeClass: "bg-[#e3b341]/10 text-[#e3b341] border-[#e3b341]/25", textClass: "text-[#e3b341]", dotClass: "bg-[#e3b341]" };
    case "failed":
      return { label: "failed", badgeClass: "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/25", textClass: "text-[#f85149]", dotClass: "bg-[#f85149]" };
    case "running":
      return { label: "running", badgeClass: "bg-[#388bfd]/10 text-[#388bfd] border-[#388bfd]/25", textClass: "text-[#388bfd]", dotClass: "bg-[#388bfd]" };
    default:
      return { label: status, badgeClass: "bg-[#30363d] text-[#8b949e] border-[#30363d]", textClass: "text-[#8b949e]", dotClass: "bg-[#484f58]" };
  }
}

export interface Finding {
  id: string;
  scan_target_id: string;
  kind: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  suggestion: string;
  diff_patch: string;
  resolved_at?: string;
}

export interface RadarRow {
  namespace: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  created: string;
}

export interface ProgressEvent {
  task_id?: string;
  message: string;
  finding?: Finding;
  done?: boolean;
}

export async function startScan(
  clusterName = "default-cluster",
  namespace = "",
  contextName = "" // empty = every loaded kubeconfig context
): Promise<{ scan_id: string }> {
  const res = await fetch(`${API_URL}/scan`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ cluster_name: clusterName, namespace, context_name: contextName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `POST /scan ${res.status}`);
  }
  return res.json();
}

export async function listScans(): Promise<Scan[]> {
  const res = await fetch(`${API_URL}/history`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /history ${res.status}`);
  const data = await res.json();
  return data.scans ?? [];
}

export async function listFindings(scanId: string): Promise<Finding[]> {
  const res = await fetch(`${API_URL}/recommendations?scan_id=${scanId}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /recommendations ${res.status}`);
  const data = await res.json();
  return data.findings ?? [];
}

export async function getRadar(): Promise<RadarRow[]> {
  const res = await fetch(`${API_URL}/radar`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /radar ${res.status}`);
  const data = await res.json();
  return data.radar ?? [];
}

export async function generatePR(findingId: string): Promise<{ pr_url: string }> {
  const res = await fetch(`${API_URL}/pr/generate`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ finding_id: findingId }),
  });
  if (!res.ok) throw new Error(`POST /pr/generate ${res.status}`);
  return res.json();
}

export async function resolveFinding(findingId: string): Promise<void> {
  // POST, not GET — resolving mutates state and must not be a safe/cacheable verb.
  const res = await fetch(`${API_URL}/findings/${findingId}/resolve`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`POST /findings/resolve ${res.status}`);
}

// ---- K8s Operations --------------------------------------------------------

export interface PodInfo {
  name: string;
  namespace: string;
  context_name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  node_name: string;
  images: string[];
  containers: string[];
  created_at: string;
}

export interface HAFinding {
  namespace: string;
  deployment: string;
  issue: string;
  detail: string;
  severity: string;
}

export async function listContexts(): Promise<string[]> {
  const res = await fetch(`${API_URL}/k8s/contexts`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/contexts ${res.status}`);
  const data = await res.json();
  return data.contexts ?? [];
}

export async function listNamespaces(context = ""): Promise<string[]> {
  const params = context ? `?context=${encodeURIComponent(context)}` : "";
  const res = await fetch(`${API_URL}/k8s/namespaces${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/namespaces ${res.status}`);
  const data = await res.json();
  return data.namespaces ?? [];
}

export async function listPods(namespace = "", context = ""): Promise<PodInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/pods${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/pods ${res.status}`);
  const data = await res.json();
  return data.pods ?? [];
}

export async function getPodLogs(namespace: string, pod: string, opts?: { container?: string; lines?: number; context?: string }): Promise<string> {
  const params = new URLSearchParams();
  if (opts?.container) params.set("container", opts.container);
  if (opts?.lines) params.set("lines", String(opts.lines));
  if (opts?.context) params.set("context", opts.context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET pod logs ${res.status}`);
  const data = await res.json();
  return data.logs ?? "";
}

export async function getResourceYAML(
  kind: string, name: string, namespace = "", context = ""
): Promise<string> {
  const params = new URLSearchParams({ kind, name });
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const res = await fetch(`${API_URL}/k8s/yaml?${params}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `GET /k8s/yaml ${res.status}`);
  }
  const data = await res.json();
  return data.yaml ?? "";
}

export async function restartDeployment(namespace: string, deployment: string, context = ""): Promise<void> {
  const res = await fetch(`${API_URL}/k8s/deployments/restart`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ namespace, deployment, context }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `restart failed ${res.status}`);
  }
}

export async function scaleDeployment(namespace: string, deployment: string, replicas: number, context = ""): Promise<void> {
  const res = await fetch(`${API_URL}/k8s/deployments/scale`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ namespace, deployment, replicas, context }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `scale failed ${res.status}`);
  }
}

export async function deletePod(namespace: string, pod: string, context = ""): Promise<void> {
  const params = context ? `?context=${encodeURIComponent(context)}` : "";
  const res = await fetch(`${API_URL}/k8s/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}${params}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `delete pod failed ${res.status}`);
  }
}

export async function applyYAML(yaml: string, context = ""): Promise<void> {
  const res = await fetch(`${API_URL}/k8s/apply`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ yaml, context }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `apply failed ${res.status}`);
  }
}

export async function applyFinding(findingId: string, context = ""): Promise<void> {
  const params = context ? `?context=${encodeURIComponent(context)}` : "";
  const res = await fetch(`${API_URL}/k8s/findings/${findingId}/apply${params}`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `apply finding failed ${res.status}`);
  }
}

export interface WorkloadInfo {
  name: string;
  namespace: string;
  ready: string;       // "2/3"
  up_to_date: number;
  available: number;
  replicas: number;
  desired: number;
  image: string;
  age: string;
  selector: string;
}

export interface JobInfo {
  name: string;
  namespace: string;
  completions: string; // "1/1"
  duration: string;
  status: string;      // Complete | Failed | Active
  image: string;
  age: string;
}

export interface CronJobInfo {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  active: number;
  last_run: string;
  age: string;
}

export async function listDeployments(namespace = "", context = ""): Promise<WorkloadInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/deployments${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/deployments ${res.status}`);
  const data = await res.json();
  return data.workloads ?? [];
}

export async function listDaemonSets(namespace = "", context = ""): Promise<WorkloadInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/daemonsets${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/daemonsets ${res.status}`);
  const data = await res.json();
  return data.workloads ?? [];
}

export async function listStatefulSets(namespace = "", context = ""): Promise<WorkloadInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/statefulsets${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/statefulsets ${res.status}`);
  const data = await res.json();
  return data.workloads ?? [];
}

export async function listReplicaSets(namespace = "", context = ""): Promise<WorkloadInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/replicasets${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/replicasets ${res.status}`);
  const data = await res.json();
  return data.workloads ?? [];
}

export async function listJobs(namespace = "", context = ""): Promise<JobInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/jobs${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/jobs ${res.status}`);
  const data = await res.json();
  return data.jobs ?? [];
}

export async function listCronJobs(namespace = "", context = ""): Promise<CronJobInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set("namespace", namespace);
  if (context) params.set("context", context);
  const qs = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_URL}/k8s/cronjobs${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/cronjobs ${res.status}`);
  const data = await res.json();
  return data.cronjobs ?? [];
}

export async function getHAAnalysis(context = ""): Promise<HAFinding[]> {
  const params = context ? `?context=${encodeURIComponent(context)}` : "";
  const res = await fetch(`${API_URL}/k8s/ha-analysis${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /k8s/ha-analysis ${res.status}`);
  const data = await res.json();
  return data.findings ?? [];
}

// ---- Ask Bob ---------------------------------------------------------------

export async function askBob(message: string, opts?: { contextType?: string; contextId?: string; k8sContext?: string }): Promise<string> {
  const res = await fetch(`${API_URL}/bob/chat`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      message,
      context_type: opts?.contextType ?? "",
      context_id: opts?.contextId ?? "",
      k8s_context: opts?.k8sContext ?? "",
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `ask bob failed ${res.status}`);
  }
  const data = await res.json();
  return data.reply ?? "";
}

// ---- Docker ----------------------------------------------------------------

export async function listContainers(): Promise<Container[]> {
  const res = await fetch(`${API_URL}/docker`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /docker ${res.status}`);
  const data = await res.json();
  return data.containers ?? [];
}

export function streamScan(scanId: string, onEvent: (e: ProgressEvent) => void): () => void {
  const h = new Headers();
  if (API_KEY) h.set("X-API-Key", API_KEY);
  const es = new EventSource(`${API_URL}/scan/${scanId}/stream`);
  es.onmessage = (e) => {
    try {
      const event: ProgressEvent = JSON.parse(e.data);
      onEvent(event);
      if (event.done) es.close();
    } catch {
      // ignore malformed
    }
  };
  es.onerror = () => es.close();
  return () => es.close();
}

// ---- GitHub local repos ----------------------------------------------------

export interface LocalRepo {
  path: string;
  name: string;
  remote_url: string;
  branch: string;
  last_commit: string;
  has_dot_github: boolean;
  workflows: number;
}

export async function listLocalRepos(root?: string): Promise<LocalRepo[]> {
  const q = root ? `?root=${encodeURIComponent(root)}` : "";
  const res = await fetch(`${API_URL}/github/repos${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /github/repos ${res.status}`);
  const data = await res.json();
  return data.repos ?? [];
}

export interface RepoFinding {
  repo: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  file: string;
  title: string;
  detail: string;
  fix: string;
}

export async function applyRepoFix(opts: {
  repoPath: string;
  file: string;
  fix: string;
  title: string;
  detail: string;
}): Promise<{ ok: boolean; branch: string; pr_url: string; note?: string }> {
  const res = await fetch(`${API_URL}/github/fix`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      repo_path: opts.repoPath,
      file: opts.file,
      fix: opts.fix,
      title: opts.title,
      detail: opts.detail,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `POST /github/fix ${res.status}`);
  }
  return res.json();
}

export async function scanGitHubRepos(paths: string[]): Promise<{ findings: RepoFinding[]; repos: string[] }> {
  const res = await fetch(`${API_URL}/github/scan`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) {
    // Surface the backend's real message (e.g. an AI timeout) instead of a bare status.
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `POST /github/scan ${res.status}`);
  }
  return res.json();
}
