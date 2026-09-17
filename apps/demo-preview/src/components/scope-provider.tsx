"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";

export type ScopeLevel = "DIVISION";

export type OperatingScope = {
  id: string;
  level: ScopeLevel;
  name: string;
  shortName: string;
  path: string[];
  roadLabel: string;
};

export const divisionScope: OperatingScope = {
  id: "division-unassigned",
  level: "DIVISION",
  name: "Yo‘l bo‘limi biriktirilmagan",
  shortName: "Yo‘l bo‘limi biriktirilmagan",
  path: ["Yo‘l bo‘limi biriktirilmagan"],
  roadLabel: "Biriktirilgan yo‘llar va kesimlar",
};

type ScopeContextValue = {
  scope: OperatingScope;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const division = user?.division;
  const scope: OperatingScope = division
    ? {
      ...divisionScope,
      id: division.id,
      name: division.name,
      shortName: division.name,
      path: [division.name],
    }
    : divisionScope;

  return <ScopeContext.Provider value={{ scope }}>{children}</ScopeContext.Provider>;
}

export function useOperatingScope() {
  const value = useContext(ScopeContext);
  if (!value) throw new Error("useOperatingScope ScopeProvider ichida ishlatilishi kerak.");
  return value;
}

export const scopeLevelLabels: Record<ScopeLevel, string> = {
  DIVISION: "Yo‘l bo‘limi",
};
