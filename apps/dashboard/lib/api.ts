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
      return { label: "completed", badgeClass: "bg-green-100 text-green-700", textClass: "text-green-600", dotClass: "bg-green-500" };
    case "completed_with_errors":
      return { label: "completed with errors", badgeClass: "bg-amber-100 text-amber-700", textClass: "text-amber-600", dotClass: "bg-amber-500" };
    case "failed":
      return { label: "failed", badgeClass: "bg-red-100 text-red-700", textClass: "text-red-600", dotClass: "bg-red-500" };
    case "running":
      return { label: "running", badgeClass: "bg-blue-100 text-blue-700", textClass: "text-blue-600", dotClass: "bg-blue-500" };
    default:
      return { label: status, badgeClass: "bg-gray-100 text-gray-500", textClass: "text-gray-400", dotClass: "bg-gray-400" };
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
