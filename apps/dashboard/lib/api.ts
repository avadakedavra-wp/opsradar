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
  status: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
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

export async function startScan(clusterName = "default-cluster", namespace = ""): Promise<{ scan_id: string }> {
  const res = await fetch(`${API_URL}/scan`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ cluster_name: clusterName, namespace }),
  });
  if (!res.ok) throw new Error(`POST /scan ${res.status}`);
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
  const res = await fetch(`${API_URL}/findings/${findingId}/resolve`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /findings/resolve ${res.status}`);
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
