"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface PodFocus {
  namespace: string;
  pod: string;
  k8sContext?: string;
}

interface BobContextValue {
  open: boolean;
  podFocus: PodFocus | null;
  openBob: (focus?: PodFocus | null) => void;
  closeBob: () => void;
}

const BobContext = createContext<BobContextValue>({
  open: false,
  podFocus: null,
  openBob: () => {},
  closeBob: () => {},
});

export function BobProvider({ children }: { children: ReactNode }) {
  const [open, setOpen]           = useState(false);
  const [podFocus, setPodFocus]   = useState<PodFocus | null>(null);

  function openBob(focus?: PodFocus | null) {
    setPodFocus(focus ?? null);
    setOpen(true);
  }

  function closeBob() {
    setOpen(false);
    setPodFocus(null);
  }

  return (
    <BobContext.Provider value={{ open, podFocus, openBob, closeBob }}>
      {children}
    </BobContext.Provider>
  );
}

export function useBob() {
  return useContext(BobContext);
}
