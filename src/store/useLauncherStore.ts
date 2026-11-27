import { create } from "zustand";
import type { Language } from "../locales/translations";

export type TabType = "home" | "versions" | "mods" | "modpacks" | "news" | "accounts" | "settings" | "dragonHost";

interface LauncherState {
  lang: Language;
  activeTab: TabType;
  ramMB: number;\n  selectedVersion: string | null;
  setLang: (lang: Language) => void;
  setActiveTab: (tab: TabType) => void;
  setRamMB: (ram: number) => void;\n  setSelectedVersion: (version: string) => void;
}

export const useLauncherStore = create<LauncherState>((set) => ({
  lang: "ar",
  activeTab: "home",
  ramMB: 4096,\n  selectedVersion: typeof localStorage !== "undefined" ? localStorage.getItem("dragon.selectedVersion") : null,
  setLang: (lang) => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
    set({ lang });
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  setRamMB: (ramMB) => set({ ramMB }),\n  setSelectedVersion: (selectedVersion) => {\n    if (typeof localStorage !== "undefined") localStorage.setItem("dragon.selectedVersion", selectedVersion);\n    set({ selectedVersion });\n  }
}));