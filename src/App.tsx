import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Blocks, Box, Cpu, Download, Flame, Gamepad2, Globe2, Home,
  Layers3, Newspaper, Play, Server, Settings, UserRound, Keyboard, type LucideIcon
} from "lucide-react";
import { useLauncherStore, type TabType } from "./store/useLauncherStore";
import { translations } from "./locales/translations";
import VersionCatalog from "./components/VersionCatalog";
import AccountsPanel from "./components/AccountsPanel";
import SettingsPanel from "./components/SettingsPanel";
import ModrinthCatalog from "./components/ModrinthCatalog";
import KeybindsPanel from "./components/KeybindsPanel";
import ServersPanel from "./components/ServersPanel";

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
  const native = isTauri();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    if (!native) return;
    invoke<SystemEnv>("get_system_environment").then(setSystem).catch(() => setSystemError(true));
  }, [native]);

  const navItems = useMemo<{ id: TabType; label: string; icon: LucideIcon }[]>(() => [
    { id: "home", label: t.home, icon: Home },
    { id: "versions", label: t.versions, icon: Layers3 },
    { id: "mods", label: t.mods, icon: Blocks },
    { id: "modpacks", label: t.modpacks, icon: Box },
    { id: "news", label: t.news, icon: Newspaper },
    { id: "accounts", label: t.accounts, icon: UserRound },
    { id: "keybinds", label: lang === "ar" ? "الأزرار" : "Keybinds", icon: Keyboard },
    { id: "servers", label: t.servers, icon: Server },
    { id: "dragonHost", label: t.dragonHost, icon: Flame },
    { id: "settings", label: t.settings, icon: Settings }
  ], [t]);

  const pageDescriptions: Partial<Record<TabType, string>> = {
    versions: t.versionsDescription, mods: t.modsDescription, modpacks: t.packsDescription,
    news: t.newsDescription, accounts: t.accountDescription, servers: t.serversDescription, dragonHost: t.hostDescription,
    settings: t.settingsDescription
  };
  const currentLabel = navItems.find(item => item.id === activeTab)?.label ?? t.home;
  const maxRam = system ? Math.max(1024, Math.min(16384, system.total_ram_mb - 1024)) : 8192;

  const handlePlay = async () => {
    setLaunchError(""); setLaunchMessage("");
    if (!native) { setLaunchError(lang === "ar" ? "شغّل نسخة التطبيق المثبتة لتشغيل Minecraft." : "Run the installed desktop app to launch Minecraft."); return; }
    if (!selectedVersion) { setLaunchError(lang === "ar" ? "اختر إصدار Minecraft أولاً." : "Select a Minecraft version first."); setActiveTab("versions"); return; }
    let accounts: Array<{ id: string; username: string; uuid: string }> = [];
    try { accounts = JSON.parse(localStorage.getItem("dragon.localAccounts") || "[]"); } catch { accounts = []; }
    const activeId = localStorage.getItem("dragon.activeAccount") || "";
    const account = accounts.find(item => item.id === activeId);
    if (!account) { setLaunchError(lang === "ar" ? "أنشئ حساباً محلياً واختره قبل اللعب." : "Create and select a local profile before playing."); setActiveTab("accounts"); return; }
    setLaunching(true);
    try {
      const result = await invoke<{ pid: number; log_file: string; java_executable: string }>("launch_minecraft", {
        versionId: selectedVersion, playerName: account.username, playerUuid: account.uuid, ramMb: ramMB
      });
      setLaunchMessage(lang === "ar"
        ? "تم إرسال اللعبة إلى Java. رقم العملية: " + result.pid + " — سجل التشغيل: " + result.log_file
        : "Minecraft was started by Java. Process: " + result.pid + " — output: " + result.log_file);
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
          ) : activeTab === "mods" ? (
            <ModrinthCatalog lang={lang} kind="mod" />
          ) : activeTab === "modpacks" ? (
            <ModrinthCatalog lang={lang} kind="modpack" />
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
                  <div className="status-value"><span className="status-warning" />{t.notInstalled}</div>
                  <div className="card-footnote">{lang === "ar" ? "لم يتم تنزيل ملفات اللعبة بعد" : "Game files have not been downloaded"}</div>
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
          <footer className="play-dock">
            <div className="dock-game-icon"><Gamepad2 size={23} /></div>
            <div className="dock-copy"><strong>Minecraft Java Edition</strong><span>{t.notInstalled} · {selectedVersion ?? (lang === "ar" ? "لا يوجد إصدار محدد" : "No version selected")}</span></div>
            <button className="play-button" onClick={() => void handlePlay()} disabled={launching || !selectedVersion || !native} title={!native ? (lang === "ar" ? "يتطلب تطبيق سطح المكتب" : "Desktop app required") : !selectedVersion ? (lang === "ar" ? "اختر إصداراً أولاً" : "Select a version first") : ""}><Play size={17} fill="currentColor" />{launching ? (lang === "ar" ? "جارٍ التشغيل..." : "Launching...") : t.play}</button>
          </footer>
          <p className="footer-note">DRAGON LAUNCHER <span>•</span> BUILT FOR YOUR WORLDS</p>
        </div>
      </main>
    </div>
  );
}
