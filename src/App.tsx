import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
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

interface GameInstance { id: string; name: string; version_id: string; created_at: number; game_directory: string; loader?: string; }

interface SystemEnv {
  os: string;
  arch: string;
  total_ram_mb: number;
  launcher_dir: string;
  runtime_target: string;
  java_detected: boolean;
  java_version: string | null;
  java_path: string | null;
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
  const [javaCompatibility, setJavaCompatibility] = useState<string>("");
  const [runtimeDownloadBusy, setRuntimeDownloadBusy] = useState(false);
  const [runtimeDownloadMessage, setRuntimeDownloadMessage] = useState("");
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [activeGamePid, setActiveGamePid] = useState<number | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<GameInstance | null>(() => { try { const raw = localStorage.getItem("dragon.activeInstance"); return raw ? JSON.parse(raw) as GameInstance : null; } catch { return null; } });
  const effectiveVersion = selectedInstance?.version_id || selectedVersion;
  const [stoppingGame, setStoppingGame] = useState(false);
  const native = isTauri();

  const downloadAndroidJava21 = async () => {
    if (!native || runtimeDownloadBusy) return;
    setRuntimeDownloadBusy(true);
    setRuntimeDownloadMessage("");
    try {
      const metadata = await invoke<{ download_url: string; checksum_sha256: string; archive_size: number; java_major: number; platform: string }>("get_android_java_runtime_download");
      const result = await invoke<{ archive_path: string; bytes: number; sha256: string; java_major: number }>("download_java_runtime", {
        downloadUrl: metadata.download_url,
        checksumSha256: metadata.checksum_sha256,
        archiveSize: metadata.archive_size,
        javaMajor: metadata.java_major,
        platform: metadata.platform
      });
      const sizeMb = (result.bytes / 1024 / 1024).toFixed(1);
      setRuntimeDownloadMessage(lang === "ar"
        ? "تم تنزيل حزمة Java 21 والتحقق من سلامتها (" + sizeMb + " MB). لم يتم تثبيتها أو تفعيلها بعد."
        : "Java 21 package downloaded and SHA-256 verified (" + sizeMb + " MB). It is not installed or activated yet.");
    } catch (error) {
      setRuntimeDownloadMessage((lang === "ar" ? "فشل تنزيل Java: " : "Java download failed: ") + String(error));
    } finally {
      setRuntimeDownloadBusy(false);
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    if (!native) return;
    invoke<SystemEnv>("get_system_environment").then(setSystem).catch(() => setSystemError(true));
  }, [native]);


  useEffect(() => {
    let cancelled = false;
    setJavaCompatibility("");
    if (!native || !effectiveVersion || !versionInstalled) return;
    invoke<{ compatible: boolean; message: string }>("check_java_compatibility", { versionId: effectiveVersion })
      .then(result => { if (!cancelled) setJavaCompatibility(result.message); })
      .catch(error => { if (!cancelled) setJavaCompatibility(String(error)); });
    return () => { cancelled = true; };
  }, [native, effectiveVersion, versionInstalled]);

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
    { id: "mods", label: t.library, icon: Blocks },
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

  const handlePlay = async () => {
    setLaunchError(""); setLaunchMessage("");
    if (!native) { setLaunchError(lang === "ar" ? "شغّل نسخة التطبيق المثبتة لتشغيل Minecraft." : "Run the installed desktop app to launch Minecraft."); return; }
    // The current Android APK is a Tauri shell only. Never proceed through the desktop
    // Java/process path until a real Android JVM + game-window/input engine is integrated.
    if (system?.os === "android") {
      setLaunchError(lang === "ar"
        ? "تشغيل Minecraft Java على Android غير متاح في هذا الإصدار بعد. ما زلنا نحتاج دمج محرك Android متكامل (JVM + LWJGL/GLFW + Renderer + شاشة وتحكم اللمس). لن يبدأ التنزيل أو التشغيل الوهمي."
        : "Minecraft Java is not launchable on Android in this build yet. A complete Android engine (JVM + LWJGL/GLFW + renderer + game surface/touch input) still needs to be integrated. No fake launch or runtime download will be attempted.");
      return;
    }
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
            <LibraryCatalog lang={lang} instanceId={selectedInstance?.id ?? null} instanceVersion={effectiveVersion} instanceLoader={selectedInstance?.loader ?? "fabric"} />
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
                    <>
                    <dl className="system-list">
                      <div><dt>{t.operatingSystem}</dt><dd>{system.os}</dd></div>
                      <div><dt>{t.architecture}</dt><dd>{system.arch}</dd></div>
                      <div><dt>{lang === "ar" ? "هدف التشغيل" : "Runtime target"}</dt><dd>{system.runtime_target}</dd></div>
                      <div><dt>{lang === "ar" ? "Java Runtime" : "Java Runtime"}</dt><dd>{system.java_detected ? (system.java_version || (lang === "ar" ? "تم العثور عليها" : "Detected")) : (lang === "ar" ? "غير مكتشفة" : "Not detected")}</dd></div>
                      {javaCompatibility && <div className="directory-row"><dt>{lang === "ar" ? "توافق Java" : "Java compatibility"}</dt><dd>{javaCompatibility}</dd></div>}
                      {system.java_path && <div className="directory-row"><dt>{lang === "ar" ? "مسار Java" : "Java path"}</dt><dd>{system.java_path}</dd></div>}
                      <div><dt>{t.totalMemory}</dt><dd>{Math.round(system.total_ram_mb / 1024)} GB</dd></div>
                      <div className="directory-row"><dt>{t.dataDirectory}</dt><dd>{system.launcher_dir}</dd></div>
                    </dl>
                    {system.os.toLowerCase() === "android" && (
                      <div className="runtime-download-actions">
                        <button className="text-action" onClick={() => void downloadAndroidJava21()} disabled={runtimeDownloadBusy}>
                          <Download size={15} /> {runtimeDownloadBusy
                            ? (lang === "ar" ? "جارٍ تنزيل Java 21..." : "Downloading Java 21...")
                            : (lang === "ar" ? "تنزيل Java 21 لأندرويد ARM64" : "Download Java 21 for Android ARM64")}
                        </button>
                        {runtimeDownloadMessage && <p className="memory-note" role="status">{runtimeDownloadMessage}</p>}
                      </div>
                    )}
                    </>
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
          <footer className="play-dock">
            <div className="dock-game-icon"><Gamepad2 size={23} /></div>
            <div className="dock-copy"><strong>Minecraft Java Edition</strong><span>{activeGamePid !== null ? (lang === "ar" ? "اللعبة تعمل · PID " : "Running · PID ") + activeGamePid : !selectedVersion ? (lang === "ar" ? "اختر إصداراً للمتابعة" : "Select a version to continue") : checkingVersion ? t.checking : versionInstalled ? (lang === "ar" ? "جاهز · " : "Ready · ") + selectedVersion : t.notInstalled + " · " + selectedVersion}</span></div>
            {activeGamePid !== null ? (
              <button className="play-button" onClick={() => void handleStopGame()} disabled={stoppingGame} title={lang === "ar" ? "إيقاف عملية Minecraft التي بدأها اللانشر" : "Stop the Minecraft process launched by DRAGON"}>
                <Square size={16} fill="currentColor" />{stoppingGame ? (lang === "ar" ? "جارٍ الإيقاف..." : "Stopping...") : (lang === "ar" ? "إيقاف" : "Stop")}
              </button>
            ) : (
              <button className="play-button" onClick={() => void handlePlay()} disabled={launching || !selectedVersion || !native || !versionInstalled || checkingVersion} title={!native ? (lang === "ar" ? "يتطلب تطبيق سطح المكتب" : "Desktop app required") : !selectedVersion ? (lang === "ar" ? "اختر إصداراً أولاً" : "Select a version first") : !versionInstalled ? (lang === "ar" ? "ثبّت الإصدار أولاً" : "Install the version first") : ""}><Play size={17} fill="currentColor" />{launching ? (lang === "ar" ? "جارٍ التشغيل..." : "Launching...") : t.play}</button>
            )}
          </footer>
          <p className="footer-note">DRAGON LAUNCHER <span>•</span> BUILT FOR YOUR WORLDS</p>
        </div>
      </main>
    </div>
  );
}
