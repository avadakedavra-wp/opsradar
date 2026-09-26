"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Lang, LANGS } from "@/lib/i18n";

// ── Theme ────────────────────────────────────────────────────

type Theme = "light" | "dark";

interface ThemeCtx { theme: Theme; toggle: () => void }
const ThemeContext = createContext<ThemeCtx>({ theme: "light", toggle: () => {} });

export function useTheme() { return useContext(ThemeContext); }

// ── Lang ─────────────────────────────────────────────────────

interface LangCtx { lang: Lang; setLang: (l: Lang) => void }
const LangContext = createContext<LangCtx>({ lang: "en", setLang: () => {} });

export function useLang() { return useContext(LangContext); }

// ── Provider ─────────────────────────────────────────────────

export default function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [lang, setLangState] = useState<Lang>("en");

  // Initialise from localStorage + system preference
  useEffect(() => {
    const stored = localStorage.getItem("or-theme") as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved: Theme = stored ?? (prefersDark ? "dark" : "light");
    setTheme(resolved);
    document.documentElement.setAttribute("data-theme", resolved);

    const storedLang = localStorage.getItem("or-lang") as Lang | null;
    const browserLang = navigator.language.slice(0, 2) as Lang;
    const validLangs = LANGS.map(l => l.code);
    const resolvedLang: Lang = storedLang ?? (validLangs.includes(browserLang) ? browserLang : "en");
    setLangState(resolvedLang);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("or-theme", next);
  }

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("or-lang", l);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <LangContext.Provider value={{ lang, setLang }}>
        {children}
      </LangContext.Provider>
    </ThemeContext.Provider>
  );
}
