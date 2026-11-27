import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  Blocks, Cpu, Download, Flame, Gamepad2, Globe2, Home,
  Layers3, Newspaper, Play, Square, Server, Settings, UserRound, Keyboard, type LucideIcon
} from "lucide-react";
import { useLauncherStore, type TabType } from "./store/useLauncherStore";
import { translations } from "./locales/translations";
import VersionCatalog from "./components/VersionCatalog";
import AccountsPanel from "./components/AccountsPanel";
import SettingsPanel from "./components/SettingsPanel";
import LibraryCatalog from "./components/LibraryCatalog";
import KeybindsPanel from "./components/KeybindsPanel";
import ServersPanel from "./components/ServersPanel";
import InstancesPanel from "./components/InstancesPanel";

interface GameInstance { id: string; name: string; version_id: string; created_at: number; game_directory: string; }

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
  const [launching, setLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState("");
  const [launchError, setLaunchError] = useState("");
  const [versionInstalled, setVersionInstalled] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [activeGamePid, setActiveGamePid] = useState<number | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<GameInstance | null>(() => { try { const raw = localStorage.getItem("dragon.activeInstance"); return raw ? JSON.parse(raw) as GameInstance : null; } catch { return null; } });
  const effectiveVersion = selectedInstance?.version_id || selectedVersion;
  const [stoppingGame, setStoppingGame] = useState(false);
  const [playWizardOpen, setPlayWizardOpen] = useState(false);
  const [playInstanceName, setPlayInstanceName] = useState(selectedInstance?.name || "Survival");
  const [playVersion, setPlayVersion] = useState(selectedInstance?.version_id || selectedVersion || "1.21.11");
  const [playDownloadBusy, setPlayDownloadBusy] = useState(false);
  const [playDownloadReady, setPlayDownloadReady] = useState(false);
  const [playProgress, setPlayProgress] = useState<{ stage: string; done: number; total: number } | null>(null);

  const native = isTauri();

  // Reconcile the saved selection against the native instance registry on every app start.
  // This prevents stale localStorage data from pointing Play at a deleted or changed instance.
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    invoke<GameInstance[]>("list_game_instances")
      .then(instances => {
        if (cancelled) return;
        const savedId = selectedInstance?.id;
        const current = savedId ? instances.find(instance => instance.id === savedId) ?? null : null;
        setSelectedInstance(current);
        if (current) localStorage.setItem("dragon.activeInstance", JSON.stringify(current));
        else localStorage.removeItem("dragon.activeInstance");
      })
      .catch(error => {
        // Keep the last saved selection if the registry cannot be read temporarily.
        console.error("Could not reconcile saved Minecraft instance:", error);
      });
    return () => { cancelled = true; };
  }, [native]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    if (!native) return;
    invoke<SystemEnv>("get_system_environment").then(setSystem).catch(() => setSystemError(true));
  }, [native]);

  // App-level listener survives page changes and refreshes one grouped Android notification.
  useEffect(() => {
    if (!native) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<{ version: string; stage: string; done: number; total: number }>("minecraft-install-progress", event => {
      const p = event.payload;
      if (p.stage === "complete") return;
      setPlayProgress({ stage: p.stage, done: p.done, total: p.total });
      const percent = p.total > 0 ? Math.min(100, Math.floor(p.done / p.total * 100)) : 0;
      const names: Record<string, string> = { client: "ملف اللعبة", libraries: "المكتبات", natives: "ملفات النظام", assets: "أصول اللعبة" };
      sendNotification({ id: 7311, title: "DRAGON Launcher", body: `تنزيل Minecraft ${p.version}: ${names[p.stage] || p.stage} — ${percent}% (${p.done}/${p.total})`, ongoing: true, autoCancel: false });
    }).then(fn => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  }, [native]);


  useEffect(() => {
    let cancelled = false;
    if (!native || !effectiveVersion) { setVersionInstalled(false); return; }
    setCheckingVersion(true);
    invoke<boolean>("is_minecraft_version_installed", { versionId: effectiveVersion })
      .then(value => { if (!cancelled) setVersionInstalled(value); })
      .catch(() => { if (!cancelled) setVersionInstalled(false); })
      .finally(() => { if (!cancelled) setCheckingVersion(false); });
    return () => { cancelled = true; };
  }, [native, effectiveVersion]);

  useEffect(() => {
    if (!native || activeGamePid === null) return;
    let cancelled = false;
    const check = async () => {
      try {
        const status = await invoke<{ pid: number; running: boolean; exit_code: number | null }>(
          "get_game_process_status", { pid: activeGamePid }
        );
        if (!cancelled && !status.running) {
          setActiveGamePid(null);
          setLaunchMessage(lang === "ar"
            ? "انتهت جلسة Minecraft" + (status.exit_code === null ? "." : " (رمز الخروج: " + status.exit_code + ").")
            : "Minecraft session ended" + (status.exit_code === null ? "." : " (exit code: " + status.exit_code + ")."));
        }
      } catch (error) {
        if (!cancelled) {
          setLaunchError(lang === "ar" ? "تعذر تحديث حالة اللعبة: " + String(error) : "Could not refresh game status: " + String(error));
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [native, activeGamePid, lang]);

  const handleStopGame = async () => {
    if (activeGamePid === null || stoppingGame) return;
    setStoppingGame(true);
    setLaunchError("");
    try {
      const result = await invoke<{ pid: number; running: boolean; exit_code: number | null }>(
        "stop_game_process", { pid: activeGamePid }
      );
      setActiveGamePid(null);
      setLaunchMessage(lang === "ar"
        ? (result.running ? "ما زالت اللعبة تعمل." : "تم إيقاف Minecraft.")
        : (result.running ? "The game is still running." : "Minecraft was stopped."));
    } catch (error) {
      setLaunchError(String(error));
    } finally {
      setStoppingGame(false);
    }
  };

  const navItems = useMemo<{ id: TabType; label: string; icon: LucideIcon }[]>(() => [
    { id: "home", label: t.home, icon: Home },
    { id: "versions", label: t.versions, icon: Layers3 },
    { id: "instances", label: lang === "ar" ? "نسخ اللعبة" : "Instances", icon: Gamepad2 },
    { id: "mods", label: lang === "ar" ? "مكتبة المودات" : "Mods Library", icon: Blocks },
    { id: "news", label: t.news, icon: Newspaper },
    { id: "accounts", label: t.accounts, icon: UserRound },
    { id: "keybinds", label: lang === "ar" ? "الأزرار" : "Keybinds", icon: Keyboard },
    { id: "servers", label: t.servers, icon: Server },
    { id: "dragonHost", label: t.dragonHost, icon: Flame },
    { id: "settings", label: t.settings, icon: Settings }
  ], [t]);

  const pageDescriptions: Partial<Record<TabType, string>> = {
    versions: t.versionsDescription, mods: t.libraryDescription,
    news: t.newsDescription, accounts: t.accountDescription, servers: t.serversDescription, dragonHost: t.hostDescription,
    settings: t.settingsDescription
  };
  const currentLabel = navItems.find(item => item.id === activeTab)?.label ?? t.home;
  const maxRam = system ? Math.max(1024, Math.min(16384, system.total_ram_mb - 1024)) : 8192;

  const launchSelectedGame = async () => {
    setLaunchError(""); setLaunchMessage("");
    if (!native) { setLaunchError(lang === "ar" ? "شغّل نسخة التطبيق المثبتة لتشغيل Minecraft." : "Run the installed desktop app to launch Minecraft."); return; }
    if (!effectiveVersion) { setLaunchError(lang === "ar" ? "اختر إصدار Minecraft أولاً." : "Select a Minecraft version first."); setActiveTab("versions"); return; }
    if (!versionInstalled) { setLaunchError(lang === "ar" ? "هذا الإصدار غير مثبت. نزّله أولاً من صفحة الإصدارات." : "This version is not installed. Install it from Versions first."); setActiveTab("versions"); return; }
    let accounts: Array<{ id: string; username: string; uuid: string }> = [];
    try { accounts = JSON.parse(localStorage.getItem("dragon.localAccounts") || "[]"); } catch { accounts = []; }
    const activeId = localStorage.getItem("dragon.activeAccount") || "";
    const account = accounts.find(item => item.id === activeId);
    if (!account) { setLaunchError(lang === "ar" ? "أنشئ حساباً محلياً واختره قبل اللعب." : "Create and select a local profile before playing."); setActiveTab("accounts"); return; }
    setLaunching(true);
    try {
      const result = await invoke<{ pid: number; log_file: string; java_executable: string }>("launch_minecraft", {
        versionId: effectiveVersion, playerName: account.username, playerUuid: account.uuid, ramMb: ramMB, instanceId: selectedInstance?.id ?? null
      });
      setActiveGamePid(result.pid);
      setLaunchMessage(lang === "ar"
        ? "بدأت Minecraft. رقم العملية: " + result.pid + " — سجل التشغيل: " + result.log_file
        : "Minecraft started. Process: " + result.pid + " — output: " + result.log_file);
    } catch (error) {
      setLaunchError(String(error));
    } finally { setLaunching(false); }
  };

  const handlePlay = () => {
    setPlayInstanceName(selectedInstance?.name || "Survival");
    setPlayVersion(selectedInstance?.version_id || selectedVersion || "1.21.11");
    setPlayDownloadReady(false); setPlayProgress(null); setPlayWizardOpen(true);
    setLaunchError(""); setLaunchMessage("");
  };

  const startPlayDownload = async () => {
    if (!native || playDownloadBusy) return;
    if (!playInstanceName.trim() || !playVersion.trim()) { setLaunchError(lang === "ar" ? "أدخل اسم النسخة وحدد إصدار Minecraft." : "Enter an instance name and Minecraft version."); return; }
    setPlayDownloadBusy(true); setPlayDownloadReady(false); setPlayProgress({ stage: "prepare", done: 0, total: 1 });
    setLaunchError(""); setLaunchMessage("");
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) throw new Error(lang === "ar" ? "اسمح بالإشعارات لتلقي تقدم التنزيل." : "Allow notifications to receive download progress.");
      const installed = await invoke<boolean>("is_minecraft_version_installed", { versionId: playVersion.trim() });
      if (!installed) await invoke("install_minecraft_version", { versionId: playVersion.trim() });
      const instance = await invoke<GameInstance>("create_game_instance", { name: playInstanceName.trim(), versionId: playVersion.trim() });
      setSelectedInstance(instance); localStorage.setItem("dragon.activeInstance", JSON.stringify(instance));
      setSelectedVersion(playVersion.trim()); setVersionInstalled(true);
      setPlayDownloadReady(true); setPlayProgress({ stage: "complete", done: 1, total: 1 });
      setLaunchMessage(lang === "ar" ? "اكتمل التنزيل وأصبحت النسخة جاهزة." : "Download complete. Your instance is ready.");
      await sendNotification({ id: 7311, title: "DRAGON Launcher", body: lang === "ar" ? `اكتمل تنزيل Minecraft ${playVersion} وإنشاء ${playInstanceName}.` : `Minecraft ${playVersion} and ${playInstanceName} are ready.`, ongoing: false, autoCancel: true });
    } catch (error) {
      setLaunchError(String(error));
      try { await sendNotification({ id: 7311, title: "DRAGON Launcher", body: lang === "ar" ? "تعذر إكمال التنزيل: " + String(error) : "Download failed: " + String(error), ongoing: false }); } catch { /* permission denied */ }
    } finally { setPlayDownloadBusy(false); }
  };

  return (
    <div className="launcher-shell" dir={lang === "ar" ? "rtl" : "ltr"}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Flame size={26} strokeWidth={2.4} /></div>
          <div className="brand-copy"><h1>DRAGON</h1><span>MINECRAFT LAUNCHER</span></div>
        </div>
        <div className="nav-caption">{lang === "ar" ? "مساحة اللعب" : "WORKSPACE"}</div>
        <nav className="side-nav" aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)} aria-current={activeTab === id ? "page" : undefined}
              className={`nav-item ${activeTab === id ? "active" : ""}`}>
              <Icon size={19} /><span>{label}</span>{activeTab === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-version"><span className="status-dot" />{lang === "ar" ? "نسخة سطح المكتب" : "Desktop client"}<small>v0.1.0</small></div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="language-button">
            <Globe2 size={18} /><span>{t.language}</span><strong>{t.switchLanguage}</strong>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>DRAGON</span><i>/</i><strong>{currentLabel}</strong></div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="mobile-language"><Globe2 size={17} />{t.switchLanguage}</button>
          <div className="topbar-status"><span className="status-dot" />{lang === "ar" ? "العميل يعمل" : "Client online"}</div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div><p className="eyebrow">{lang === "ar" ? "مركز التحكم" : "CONTROL CENTER"}</p><h2>{activeTab === "home" ? t.appName : currentLabel}</h2><p>{t.subtitle}</p></div>
            {activeTab === "home" && <div className="edition-pill"><Gamepad2 size={16} /> MINECRAFT JAVA EDITION</div>}
          </section>

          {activeTab === "versions" ? (
            <VersionCatalog lang={lang} selectedVersion={selectedVersion} onSelect={setSelectedVersion} />
           ) : activeTab === "instances" ? (
            <InstancesPanel lang={lang} selectedId={selectedInstance?.id ?? null} onSelect={(item) => { setSelectedInstance(item); if (item) localStorage.setItem("dragon.activeInstance", JSON.stringify(item)); else localStorage.removeItem("dragon.activeInstance"); setLaunchMessage(item ? (lang === "ar" ? `النسخة المحددة: ${item.name}` : `Selected instance: ${item.name}`) : ""); }} />
          ) : activeTab === "mods" ? (
            <LibraryCatalog lang={lang} instanceId={selectedInstance?.id ?? null} />
          ) : activeTab === "accounts" ? (
            <AccountsPanel lang={lang} />
          ) : activeTab === "keybinds" ? (
            <KeybindsPanel lang={lang} />
          ) : activeTab === "settings" ? (
            <SettingsPanel lang={lang} />
          ) : activeTab === "servers" ? (
            <ServersPanel lang={lang} />
          ) : activeTab === "home" ? (
            <div className="home-layout">
              <section className="welcome-card">
                <div className="welcome-glow" />
                <div className="welcome-content">
                  <span className="welcome-kicker"><Flame size={15} /> {lang === "ar" ? "بوابتك إلى عوالمك" : "YOUR GATEWAY TO MINECRAFT"}</span>
                  <h3>{lang === "ar" ? <>مغامرتك القادمة<br /><em>تبدأ من هنا.</em></> : <>Your next adventure<br /><em>starts here.</em></>}</h3>
                  <p>{lang === "ar" ? "اختر إصدار Minecraft وجهّز بيئة اللعب الخاصة بك من مكان واحد." : "Choose your Minecraft version and prepare your game environment in one place."}</p>
                  <button className="browse-button" onClick={() => setActiveTab("versions")}><Layers3 size={17} />{lang === "ar" ? "استعراض الإصدارات" : "Browse versions"}</button>
                </div>
                <div className="dragon-emblem"><Flame size={118} strokeWidth={1.1} /></div>
                <div className="welcome-orbit orbit-one" /><div className="welcome-orbit orbit-two" />
              </section>

              <section className="overview-grid">
                <article className="info-card version-card">
                  <div className="card-heading"><span className="card-icon"><Layers3 size={19} /></span><span>{t.selectedVersion}</span></div>
                  <div className="card-main-value">{selectedVersion ?? (lang === "ar" ? "لم يتم الاختيار" : "Not selected")}</div>
                  <div className="card-footnote">{lang === "ar" ? "اختر إصداراً من مكتبة Mojang الرسمية" : "Choose a release from Mojang's catalog"}</div>
                  <button className="text-action" onClick={() => setActiveTab("versions")}>{lang === "ar" ? "اختيار إصدار" : "Choose version"} <span>↗</span></button>
                </article>
                <article className="info-card">
                  <div className="card-heading"><span className="card-icon amber"><Download size={19} /></span><span>{t.status}</span></div>
                  <div className="status-value"><span className={versionInstalled ? "status-dot" : "status-warning"} />{checkingVersion ? t.checking : versionInstalled ? t.installed : t.notInstalled}</div>
                  <div className="card-footnote">{versionInstalled ? (lang === "ar" ? "ملفات الإصدار المحدد موجودة على الجهاز" : "Selected version files are present on this device") : (lang === "ar" ? "نزّل الإصدار المحدد لتتمكن من تشغيله" : "Install the selected version before launching")}</div>
                  <button className="text-action" onClick={() => setActiveTab("versions")}>{lang === "ar" ? "ابدأ من الإصدارات" : "Go to versions"} <span>↗</span></button>
                </article>
              </section>

              <section className="details-grid">
                <article className="panel-card">
                  <div className="panel-title"><span className="card-icon"><Cpu size={19} /></span><div><h3>{t.system}</h3><p>{lang === "ar" ? "ملخص بيئة التشغيل الحالية" : "Current runtime environment"}</p></div></div>
                  {system ? (
                    <dl className="system-list">
                      <div><dt>{t.operatingSystem}</dt><dd>{system.os}</dd></div>
                      <div><dt>{t.architecture}</dt><dd>{system.arch}</dd></div>
                      <div><dt>{t.totalMemory}</dt><dd>{Math.round(system.total_ram_mb / 1024)} GB</dd></div>
                      <div className="directory-row"><dt>{t.dataDirectory}</dt><dd>{system.launcher_dir}</dd></div>
                    </dl>
                  ) : <div className="empty-state">{systemError ? t.unavailable : native ? t.loading : t.unavailable}</div>}
                </article>
                <article className="panel-card memory-card">
                  <div className="panel-title"><span className="card-icon"><Cpu size={19} /></span><div><h3>{t.ram}</h3><p>{lang === "ar" ? "تخصيص الذاكرة للعبة" : "Memory reserved for Minecraft"}</p></div></div>
                  <div className="ram-number">{(ramMB / 1024).toFixed(1)} <small>GB</small></div>
                  <input aria-label={t.ram} type="range" min={1024} max={maxRam} step={512} value={Math.min(ramMB, maxRam)} onChange={e => setRamMB(Number(e.target.value))} />
                  <div className="range-labels"><span>1 GB</span><span>{(maxRam / 1024).toFixed(1)} GB</span></div>
                  <p className="memory-note">{lang === "ar" ? "يتم تمرير هذه القيمة إلى أمر تشغيل Java عند بدء اللعبة." : "This value is passed to the Java launch command."}</p>
                </article>
              </section>
            </div>
          ) : (
            <section className="placeholder-panel">
              <div className="placeholder-icon"><Download size={27} /></div>
              <h3>{currentLabel}</h3><p>{pageDescriptions[activeTab]}</p>
              <span className="coming-label">{lang === "ar" ? "قيد التطوير — لن نعرض وظائف وهمية" : "In development — no fake controls"}</span>
            </section>
          )}
          {(launchMessage || launchError) && <div className={"launch-feedback " + (launchError ? "is-error" : "is-success")} role="status">{launchError || launchMessage}</div>}
          {playWizardOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="play-wizard-title">
            <section className="w-full max-w-lg rounded-2xl border border-dragon-border bg-dragon-panel p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3"><div><p className="eyebrow">DRAGON QUICK PLAY</p><h3 id="play-wizard-title" className="text-xl font-bold">{lang === "ar" ? "تجهيز نسخة للعب" : "Prepare an instance to play"}</h3></div><button onClick={() => !playDownloadBusy && setPlayWizardOpen(false)} disabled={playDownloadBusy} className="rounded-lg border border-dragon-border px-3 py-2 text-sm disabled:opacity-40">{lang === "ar" ? "إغلاق" : "Close"}</button></div>
              <label className="mb-3 block text-sm"><span className="mb-2 block text-slate-300">{lang === "ar" ? "إصدار Minecraft" : "Minecraft version"}</span><input value={playVersion} onChange={e => setPlayVersion(e.target.value)} disabled={playDownloadBusy || playDownloadReady} placeholder="1.21.11" className="w-full rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 outline-none focus:border-dragon-accent" /></label>
              <label className="mb-4 block text-sm"><span className="mb-2 block text-slate-300">{lang === "ar" ? "اسم الـ Instance" : "Instance name"}</span><input value={playInstanceName} onChange={e => setPlayInstanceName(e.target.value)} maxLength={40} disabled={playDownloadBusy || playDownloadReady} placeholder="Survival" className="w-full rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 outline-none focus:border-dragon-accent" /></label>
              {playDownloadBusy && <div className="mb-4 rounded-xl border border-dragon-border bg-dragon-dark p-4"><div className="mb-2 flex justify-between text-sm"><strong>{lang === "ar" ? "جارٍ تنزيل ملفات اللعبة" : "Downloading game files"}</strong><span className="font-mono text-emerald-300">{playProgress?.total ? Math.floor(playProgress.done / playProgress.total * 100) : 0}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: (playProgress?.total ? Math.min(100, playProgress.done / playProgress.total * 100) : 0) + "%" }} /></div><p className="mt-2 text-xs text-slate-400">{playProgress ? `${playProgress.stage} — ${playProgress.done}/${playProgress.total}` : (lang === "ar" ? "جارٍ التحضير..." : "Preparing...")}</p></div>}
              {playDownloadReady ? <div className="space-y-3"><p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{lang === "ar" ? "اكتمل التنزيل وتم إنشاء النسخة. يمكنك بدء اللعب." : "Download complete and instance created. You can start playing."}</p><button onClick={() => { setPlayWizardOpen(false); void launchSelectedGame(); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white"><Play size={17} fill="currentColor" />{lang === "ar" ? "ابدأ اللعب" : "Start playing"}</button></div> : <button onClick={() => void startPlayDownload()} disabled={playDownloadBusy || !playVersion.trim() || !playInstanceName.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-dragon-accent px-4 py-3 font-bold text-white disabled:opacity-50"><Download size={17} />{playDownloadBusy ? (lang === "ar" ? "جارٍ التنزيل..." : "Downloading...") : (lang === "ar" ? "إنشاء النسخة وبدء التنزيل" : "Create instance & download")}</button>}
              <p className="mt-3 text-xs leading-5 text-slate-500">{lang === "ar" ? "سيُطلب إذن الإشعارات لتحديث تقدم التنزيل. أبقِ التطبيق مفتوحاً حالياً؛ خدمة Android الأمامية المضمونة لم تُضف بعد." : "Notification permission is requested for progress updates. Keep the app open for now; a dedicated Android foreground service is not included yet."}</p>
            </section>
          </div>}
          <footer className="play-dock">
            <div className="dock-game-icon"><Gamepad2 size={23} /></div>
            <div className="dock-copy"><strong>Minecraft Java Edition</strong><span>{activeGamePid !== null ? (lang === "ar" ? "اللعبة تعمل · PID " : "Running · PID ") + activeGamePid : !effectiveVersion ? (lang === "ar" ? "اختر إصداراً للمتابعة" : "Select a version to continue") : checkingVersion ? t.checking : versionInstalled ? (lang === "ar" ? "جاهز · " : "Ready · ") + effectiveVersion : t.notInstalled + " · " + effectiveVersion}</span></div>
            {activeGamePid !== null ? (
              <button className="play-button" onClick={() => void handleStopGame()} disabled={stoppingGame} title={lang === "ar" ? "إيقاف عملية Minecraft التي بدأها اللانشر" : "Stop the Minecraft process launched by DRAGON"}>
                <Square size={16} fill="currentColor" />{stoppingGame ? (lang === "ar" ? "جارٍ الإيقاف..." : "Stopping...") : (lang === "ar" ? "إيقاف" : "Stop")}
              </button>
            ) : (
              <button className="play-button" onClick={() => void handlePlay()} disabled={launching || !native} title={!native ? (lang === "ar" ? "يتطلب التطبيق المثبت" : "Installed app required") : ""}><Play size={17} fill="currentColor" />{launching ? (lang === "ar" ? "جارٍ التشغيل..." : "Launching...") : t.play}</button>
            )}
          </footer>
          <p className="footer-note">DRAGON LAUNCHER <span>•</span> BUILT FOR YOUR WORLDS</p>
        </div>
      </main>
    </div>
  );
}
