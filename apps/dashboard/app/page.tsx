"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRadar, listScans, startScan, Scan, RadarRow } from "@/lib/api";
import RadarHeatmap from "@/components/RadarHeatmap";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();
  const [radar, setRadar] = useState<RadarRow[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getRadar(), listScans()])
      .then(([r, s]) => {
        setRadar(r);
        setScans(s);
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function handleScanNow() {
    setScanning(true);
    setError(null);
    try {
      const { scan_id } = await startScan();
      router.push(`/scan/${scan_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setScanning(false);
    }
  }

  const latestScan = scans[0];

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OpsRadar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kubernetes operations intelligence, powered by Bob</p>
        </div>
        <button
          onClick={handleScanNow}
          disabled={scanning}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-60"
        >
          {scanning ? "Starting scan…" : "⚡ Scan Now"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Radar Heatmap */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Namespace Radar</h2>
        <RadarHeatmap data={radar} />
        <p className="text-xs text-gray-400 mt-2">
          Based on latest completed scan. Green = clean, Red = critical findings.
        </p>
      </section>

      {/* Recent scans */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Scans</h2>
          <Link href="/history" className="text-sm text-indigo-600 hover:underline">View all →</Link>
        </div>
        {scans.length === 0 ? (
          <p className="text-sm text-gray-400">No scans yet. Click &ldquo;Scan Now&rdquo; to start.</p>
        ) : (
          <div className="space-y-2">
            {scans.slice(0, 5).map((scan) => (
              <Link
                key={scan.id}
                href={`/scan/${scan.id}`}
                className="flex items-center justify-between border rounded-lg px-4 py-3 hover:bg-gray-50"
              >
                <div>
                  <span className="font-medium text-sm">{scan.cluster_name}</span>
                  <span className="text-xs text-gray-400 ml-2">{new Date(scan.started_at).toLocaleString()}</span>
                </div>
                <div className="flex gap-2 text-xs items-center">
                  {scan.critical > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{scan.critical} critical</span>}
                  {scan.high > 0 && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{scan.high} high</span>}
                  <span className={`px-2 py-0.5 rounded-full ${scan.status === "completed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {scan.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Quick nav */}
      <nav className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t">
        {[
          { href: "/recommendations", label: "Recommendations", icon: "📋" },
          { href: "/history", label: "History", icon: "📈" },
          { href: "/docker", label: "Containers", icon: "🐳" },
          latestScan
            ? { href: `/scan/${latestScan.id}`, label: "Latest Scan", icon: "🔍" }
            : { href: "#", label: "Latest Scan", icon: "🔍" },
        ].map(({ href, label, icon }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-2 border rounded-lg px-3 py-2.5 text-sm hover:bg-gray-50"
          >
            <span>{icon}</span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
