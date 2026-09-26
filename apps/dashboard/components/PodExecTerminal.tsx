"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

interface Props {
  namespace: string;
  pod: string;
  container?: string;
  context?: string;
}

// Loaded via next/dynamic({ ssr:false }) so xterm never evaluates on the server.
export default function PodExecTerminal({ namespace, pod, container, context }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#388bfd",
        selectionBackground: "#1f6feb55",
        black: "#484f58", red: "#f85149", green: "#3fb950", yellow: "#e3b341",
        blue: "#388bfd", magenta: "#a78bfa", cyan: "#39c5cf", white: "#c9d1d9",
        brightBlack: "#6e7681", brightRed: "#ff7b72", brightGreen: "#56d364",
        brightYellow: "#e3b341", brightBlue: "#58a6ff", brightMagenta: "#bc8cff",
        brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try { fit.fit(); } catch { /* container not laid out yet */ }

    const wsBase = API_URL.replace(/^http/, "ws");
    const params = new URLSearchParams();
    if (container) params.set("container", container);
    if (context) params.set("context", context);
    if (API_KEY) params.set("key", API_KEY);
    const url = `${wsBase}/k8s/exec/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}?${params}`;

    term.write("\x1b[90mconnecting to " + pod + "…\x1b[0m\r\n");
    const ws = new WebSocket(url);

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => { sendResize(); term.focus(); };
    ws.onmessage = e => term.write(typeof e.data === "string" ? e.data : "");
    ws.onclose = () => term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
    ws.onerror = () => term.write("\r\n\x1b[31m[connection error — is the API reachable?]\x1b[0m\r\n");

    const dataSub = term.onData(d => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stdin", data: d }));
    });
    const resizeSub = term.onResize(sendResize);

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [namespace, pod, container, context]);

  return <div ref={hostRef} className="h-full w-full" style={{ background: "#0d1117", padding: "6px 4px" }} />;
}
