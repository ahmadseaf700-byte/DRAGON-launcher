import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Blocks, Box, Cpu, Download, Flame, Gamepad2, Globe2, Home,
  Layers3, Newspaper, Play, Server, Settings, UserRound, type LucideIcon
} from "lucide-react";
import { useLauncherStore, type TabType } from "./store/useLauncherStore";
import { translations } from "./locales/translations";
import VersionCatalog from "./components/VersionCatalog";

interface SystemEnv {
  os: string;
  arch: string;
  total_ram_mb: number;
  launcher_dir: string;
}

export default function App() {
  const { lang, setLang, activeTab, setActiveTab, ramMB, setRamMB, selectedVersion, setSelectedVersion } = useLauncherStore();
  const t = translations[lang];
  const [system, setSystem] = useState<SystemEnv | null>(null);
  const [systemError, setSystemError] = useState(false);
  const [playMessage, setPlayMessage] = useState(t.preparing);
  const native = isTauri();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    setPlayMessage(t.preparing);
  }, [lang, t.preparing]);

  useEffect(() => {
    if (!native) return;
    invoke<SystemEnv>("get_system_environment")
      .then(setSystem)
      .catch(() => setSystemError(true));
  }, [native]);

  const navItems = useMemo<{ id: TabType; label: string; icon: LucideIcon }[]>(() => [
    { id: "home", label: t.home, icon: Home },
    { id: "versions", label: t.versions, icon: Layers3 },
    { id: "mods", label: t.mods, icon: Blocks },
    { id: "modpacks", label: t.modpacks, icon: Box },
    { id: "news", label: t.news, icon: Newspaper },
    { id: "accounts", label: t.accounts, icon: UserRound },
    { id: "dragonHost", label: t.dragonHost, icon: Server },
    { id: "settings", label: t.settings, icon: Settings }
  ], [t]);

  const pageDescriptions: Partial<Record<TabType, string>> = {
    versions: t.versionsDescription,
    mods: t.modsDescription,
    modpacks: t.packsDescription,
    news: t.newsDescription,
    accounts: t.accountDescription,
    dragonHost: t.hostDescription,
    settings: t.settingsDescription
  };

  const handlePlay = () => setPlayMessage(t.notInstalled);
  const maxRam = system ? Math.max(1024, Math.min(16384, system.total_ram_mb - 1024)) : 8192;

  return (
    <div className="min-h-screen bg-dragon-dark text-slate-100 md:flex" dir={lang === "ar" ? "rtl" : "ltr"}>
      <aside className="flex w-full flex-col border-b border-dragon-border bg-dragon-panel p-4 md:min-h-screen md:w-64 md:border-b-0 md:border-e">
        <div className="mb-7 flex items-center gap-3 border-b border-dragon-border px-2 pb-5 pt-2">
          <div className="rounded-xl bg-dragon-accent p-2.5 shadow-glow"><Flame size={25} /></div>
          <div>
            <h1 className="text-xl font-extrabold tracking-wider">DRAGON</h1>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-slate-500">MINECRAFT LAUNCHER</p>
          </div>
        </div>
        <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${activeTab === id ? "bg-dragon-accent text-white shadow-glow" : "text-slate-400 hover:bg-dragon-card hover:text-white"}`}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-dragon-border pt-4 md:block">
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="flex w-full items-center justify-between rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 text-sm text-slate-300 hover:border-dragon-accent">
            <span className="flex items-center gap-2"><Globe2 size={17} className="text-rose-400" />{t.language}</span>
            <span className="font-bold text-rose-400">{t.switchLanguage}</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-rose-400">DRAGON / {activeTab}</p>
            <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">{activeTab === "home" ? t.appName : navItems.find(x => x.id === activeTab)?.label}</h2>
            <p className="mt-1 text-sm text-slate-400">{t.subtitle}</p>
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="flex items-center gap-2 rounded-xl border border-dragon-border bg-dragon-panel px-4 py-2.5 text-sm hover:border-dragon-accent md:hidden">
            <Globe2 size={16} />{t.switchLanguage}
          </button>
        </header>

        {activeTab === "versions" ? (
          <VersionCatalog lang={lang} selectedVersion={selectedVersion} onSelect={setSelectedVersion} />
        ) : activeTab === "home" ? (
          <>
            <section className="relative overflow-hidden rounded-3xl border border-dragon-border bg-gradient-to-br from-dragon-card via-[#171827] to-[#301321] p-6 shadow-glow sm:p-9">
              <div className="pointer-events-none absolute -end-12 -top-20 h-64 w-64 rounded-full bg-rose-600/10 blur-3xl" />
              <div className="relative max-w-2xl">
                <span className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs font-bold text-rose-300"><Gamepad2 size={14} /> MINECRAFT JAVA EDITION</span>
                <h3 className="mt-5 text-3xl font-black sm:text-5xl">DRAGON</h3>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300">{t.subtitle}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"><p className="text-xs text-slate-400">{t.status}</p><p className="mt-1 text-sm font-bold text-amber-300">{t.notInstalled}</p></div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"><p className="text-xs text-slate-400">{t.selectedVersion}</p><p className="mt-1 text-sm font-bold">{selectedVersion ?? "—"}</p></div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-dragon-border bg-dragon-panel p-5">
                <div className="mb-4 flex items-center gap-2 font-bold"><Cpu className="text-rose-400" size={19} />{t.system}</div>
                {system ? (
                  <dl className="grid gap-3 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">{t.operatingSystem}</dt><dd className="font-mono">{system.os}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">{t.architecture}</dt><dd className="font-mono">{system.arch}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">{t.totalMemory}</dt><dd className="font-mono">{Math.round(system.total_ram_mb / 1024)} GB</dd></div>
                    <div className="border-t border-dragon-border pt-3"><dt className="mb-1 text-slate-400">{t.dataDirectory}</dt><dd className="break-all font-mono text-xs text-slate-300">{system.launcher_dir}</dd></div>
                  </dl>
                ) : <p className="text-sm text-slate-400">{systemError ? t.unavailable : native ? t.loading : t.unavailable}</p>}
              </div>

              <div className="rounded-2xl border border-dragon-border bg-dragon-panel p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold"><Cpu className="text-rose-400" size={19} />{t.ram}</div>
                  <span className="font-mono font-bold text-rose-300">{ramMB} MB</span>
                </div>
                <input aria-label={t.ram} type="range" min={1024} max={maxRam} step={512}
                  value={Math.min(ramMB, maxRam)} onChange={e => setRamMB(Number(e.target.value))}
                  className="w-full cursor-pointer accent-rose-500" />
                <p className="mt-3 text-xs leading-6 text-slate-400">{t.preparing}</p>
              </div>
            </section>
          </>
        ) : (
          <section className="flex min-h-64 flex-col items-start justify-center rounded-2xl border border-dragon-border bg-dragon-panel p-7">
            <div className="mb-4 rounded-xl bg-rose-500/10 p-3 text-rose-400"><Download size={25} /></div>
            <h3 className="text-xl font-bold">{navItems.find(x => x.id === activeTab)?.label}</h3>
            <p className="mt-2 max-w-xl text-sm leading-7 text-slate-400">{pageDescriptions[activeTab]}</p>
          </section>
        )}

        <footer className="mt-auto rounded-2xl border border-dragon-border bg-dragon-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0"><p className="text-xs text-slate-400">{playMessage}</p><p className="mt-1 text-sm font-bold">Minecraft Java Edition</p></div>
            <button onClick={handlePlay} disabled className="flex items-center gap-2 rounded-xl bg-dragon-accent px-6 py-3 font-bold shadow-glow transition hover:bg-rose-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" title={t.notInstalled}>
              <Play size={18} fill="currentColor" />{t.play}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}