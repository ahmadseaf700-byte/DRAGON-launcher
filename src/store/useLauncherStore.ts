import { create } from "zustand";
import type { Language } from "../locales/translations";

export type TabType = "home" | "versions" | "mods" | "modpacks" | "news" | "accounts" | "settings" | "dragonHost";

interface LauncherState {
  lang: Language;
  activeTab: TabType;
  ramMB: number;
  setLang: (lang: Language) => void;
  setActiveTab: (tab: TabType) => void;
  setRamMB: (ram: number) => void;
}

export const useLauncherStore = create<LauncherState>((set) => ({
  lang: "ar",
  activeTab: "home",
  ramMB: 4096,
  setLang: (lang) => {
    if (typeof document !== "undefined") {
      document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
    set({ lang });
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  setRamMB: (ramMB) => set({ ramMB })
}));