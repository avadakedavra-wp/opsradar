"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ShieldAlert,
  Server,
  History,
  MessageCircle,
  Radio,
  GitBranch,
} from "lucide-react";
import AskBobSidebar from "@/components/AskBobSidebar";

const NAV = [
  { href: "/",                label: "Radar",    Icon: Activity    },
  { href: "/recommendations", label: "Findings", Icon: ShieldAlert },
  { href: "/cluster",         label: "Cluster",  Icon: Server      },
  { href: "/github",          label: "GitHub",   Icon: GitBranch   },
  { href: "/history",         label: "History",  Icon: History     },
];

function NavItem({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-[#1f2937] text-[#f0f6fc] font-medium"
          : "text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#1c2128]"
      }`}
    >
      <Icon
        size={15}
        className={active ? "text-[#388bfd]" : ""}
      />
      <span>{label}</span>
    </Link>
  );
}

export default function NavShell({ children }: { children: React.ReactNode }) {
  const [bobOpen, setBobOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <aside className="w-[216px] shrink-0 bg-[#161b22] border-r border-[#21262d] flex flex-col">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-[#21262d] shrink-0">
          <div className="w-7 h-7 rounded-md bg-[#388bfd]/10 border border-[#388bfd]/25 flex items-center justify-center">
            <Radio size={13} className="text-[#388bfd]" />
          </div>
          <div className="leading-none">
            <div className="text-[13px] font-semibold text-[#f0f6fc] tracking-tight">OpsRadar</div>
            <div className="text-[10px] text-[#484f58] mt-0.5 font-mono tracking-wide">k8s intelligence</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV.map(({ href, label, Icon }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              active={isActive(href)}
            />
          ))}
        </nav>

        {/* Ask Bob — pinned to bottom */}
        <div className="p-2 border-t border-[#21262d] shrink-0">
          <button
            onClick={() => setBobOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#1c2128] transition-colors"
          >
            <MessageCircle size={15} />
            <span>Ask Bob</span>
            <span className="ml-auto text-[10px] font-mono text-[#388bfd] bg-[#388bfd]/10 px-1.5 py-0.5 rounded">
              AI
            </span>
          </button>
        </div>
      </aside>

      {/* Main content area — overflow-hidden so children can own their scroll */}
      <div className="flex-1 overflow-hidden min-w-0 flex flex-col">
        {children}
      </div>

      {/* Ask Bob overlay panel */}
      <AskBobSidebar open={bobOpen} onClose={() => setBobOpen(false)} />
    </div>
  );
}
