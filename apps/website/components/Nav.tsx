"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme, useLang } from "@/components/Providers";
import { LANGS, translations } from "@/lib/i18n";

export default function Nav() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const t = translations[lang].nav;
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 w-full border-b"
      style={{ background: "var(--bg)", borderColor: "var(--border)" }}
    >
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="font-bold text-lg tracking-tight token-text flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-black text-white"
            style={{ background: "var(--accent)" }}
            aria-hidden
          >OR</span>
          OpsRadar
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm token-muted">
          <a href="#product"  className="hover:token-text hover:text-[var(--text)] transition-colors">{t.product}</a>
          <a href="/docs"     className="hover:text-[var(--text)] transition-colors">{t.docs}</a>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text)] transition-colors">{t.github}</a>
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm border transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {/* Lang picker */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(v => !v)}
              aria-label="Select language"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs border transition-colors"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {LANGS.find(l => l.code === lang)?.flag ?? "🌐"}
            </button>
            {langOpen && (
              <div
                className="absolute right-0 top-10 rounded-xl border shadow-lg py-1 min-w-36 z-50"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
              >
                {LANGS.map(l => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setLangOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors"
                    style={{
                      color: lang === l.code ? "var(--accent)" : "var(--text)",
                      background: lang === l.code ? "var(--accent-glow)" : "transparent",
                    }}
                  >
                    <span>{l.flag}</span>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CTA */}
          <a
            href="/docs"
            className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            {t.getStarted}
          </a>

          {/* Mobile burger */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg border"
            style={{ border: "1px solid var(--border)" }}
            aria-label="Toggle menu"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t px-4 py-4 flex flex-col gap-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          {[["#product", t.product], ["/docs", t.docs], ["https://github.com", t.github]].map(([href, label]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ color: "var(--text-muted)" }} className="hover:text-[var(--text)]">{label}</a>
          ))}
        </div>
      )}
    </header>
  );
}
