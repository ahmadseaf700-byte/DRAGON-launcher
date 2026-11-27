import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Save, Settings2, CheckCircle2, ScrollText, Keyboard, RefreshCw } from "lucide-react";
import type { Language } from "../locales/translations";
import { useLauncherStore } from "../store/useLauncherStore";

type LauncherConfig = { ram_mb: number; game_directory: string; java_path: string; window_width: number; window_height: number; language: string };

const defaults: LauncherConfig = { ram_mb: 4096, game_directory: "", java_path: "", window_width: 1280, window_height: 720, language: "ar" };

export default function SettingsPanel({ lang }: { lang: Language }) {
  const ar = lang === "ar";
  const { ramMB, setRamMB, setActiveTab } = useLauncherStore();
  const [section, setSection] = useState<"general" | "log">("general");
  const [gameLog, setGameLog] = useState("");
  const [logError, setLogError] = useState("");
  const [loadingLog, setLoadingLog] = useState(false);
  const [config, setConfig] = useState<LauncherConfig>(defaults);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const native = isTauri();

  useEffect(() => {
    const load = async () => {
      try {
        const saved = native
          ? await invoke<LauncherConfig>("load_launcher_config")
          : JSON.parse(localStorage.getItem("dragon.launcherConfig") || "null") as LauncherConfig | null;
        if (saved) {
          setConfig({ ...defaults, ...saved });
          setRamMB(saved.ram_mb || 4096);
        } else setConfig({ ...defaults, ram_mb: ramMB });
      } catch { setConfig({ ...defaults, ram_mb: ramMB }); }
    };
    void load();
  }, [native]);

  const update = (patch: Partial<LauncherConfig>) => setConfig(current => ({ ...current, ...patch }));
  const save = async () => {
    setSaving(true); setMessage("");
    const next = { ...config, ram_mb: ramMB };
    try {
      if (native) await invoke("save_launcher_config", { config: next });
      else localStorage.setItem("dragon.launcherConfig", JSON.stringify(next));
      setConfig(next);
      setMessage(ar ? "تم حفظ الإعدادات بنجاح." : "Settings saved successfully.");
    } catch (e) {
      setMessage((ar ? "تعذر الحفظ: " : "Save failed: ") + String(e));
    } finally { setSaving(false); }
  };

  const refreshLog = async () => {
    if (!native) { setLogError(ar ? "سجل Minecraft يتوفر داخل التطبيق بعد تشغيل اللعبة." : "Minecraft logs are available in the installed app after the game has run."); return; }
    setLoadingLog(true); setLogError("");
    try { setGameLog(await invoke<string>("read_game_log")); }
    catch (e) { setLogError(String(e)); }
    finally { setLoadingLog(false); }
  };

  return <section className="feature-page">
    <div className="feature-intro"><div className="feature-symbol"><Settings2 size={25} /></div><div><h3>{ar ? "إعدادات اللانشر" : "Launcher settings"}</h3><p>{ar ? "إعدادات اللعبة وسجل الإخراج وأدوات التحكم." : "Game preferences, output log and controls."}</p></div></div>
    <div className="settings-actions"><button onClick={() => setSection("general")}><Settings2 size={16}/>{ar ? "الإعدادات العامة" : "General"}</button><button onClick={() => setActiveTab("keybinds")}><Keyboard size={16}/>{ar ? "أزرار التحكم الأساسية" : "Key controls"}</button><button onClick={() => { setSection("log"); void refreshLog(); }}><ScrollText size={16}/>{ar ? "سجل الإخراج" : "Output log"}</button></div>
    {section === "log" ? <div className="settings-group"><div className="settings-label"><strong>{ar ? "سجل Minecraft — latest.log" : "Minecraft output — latest.log"}</strong><button className="account-select" onClick={() => void refreshLog()} disabled={loadingLog}><RefreshCw size={14}/>{loadingLog ? "…" : (ar ? "تحديث" : "Refresh")}</button></div>{logError && <p className="feature-error">{logError}</p>}<pre className="game-log-view">{gameLog || (ar ? "لا يوجد سجل بعد. شغّل اللعبة أولاً ثم اضغط تحديث." : "No log yet. Run the game first, then refresh.")}</pre></div> : <>
    <div className="settings-group"><div className="settings-label"><strong>{ar ? "تخصيص الذاكرة RAM" : "RAM allocation"}</strong><b>{(ramMB / 1024).toFixed(1)} GB</b></div><input type="range" min="1024" max="12288" step="512" value={ramMB} onChange={e => setRamMB(Number(e.target.value))} /><div className="range-labels"><span>1 GB</span><span>12 GB</span></div><p className="feature-footnote">{ar ? "سيتم تطبيق هذا الحد عند ربط إعدادات JVM بمحرك التشغيل." : "This limit will be applied to JVM arguments when the runtime engine is connected."}</p></div>
    <div className="settings-group"><label>{ar ? "مجلد تثبيت اللعبة" : "Game installation directory"}</label><input className="feature-input" value={config.game_directory} onChange={e => update({ game_directory: e.target.value })} placeholder={ar ? "اتركه فارغاً لاستخدام المجلد الافتراضي" : "Leave empty to use the default directory"} /><p className="feature-footnote">{ar ? "أدخل مساراً موجوداً على الجهاز. اختيار المجلد من نافذة النظام سيضاف لاحقاً." : "Enter an existing device path. Native folder picker integration is not added yet."}</p></div>
    <div className="settings-two"><div className="settings-group"><label>{ar ? "مسار Java" : "Java executable path"}</label><input className="feature-input" value={config.java_path} onChange={e => update({ java_path: e.target.value })} placeholder="java / path/to/java" /></div><div className="settings-group"><label>{ar ? "عرض نافذة اللعبة" : "Game window width"}</label><input className="feature-input" type="number" min="640" max="7680" value={config.window_width} onChange={e => update({ window_width: Math.max(640, Number(e.target.value)) })} /></div><div className="settings-group"><label>{ar ? "ارتفاع نافذة اللعبة" : "Game window height"}</label><input className="feature-input" type="number" min="480" max="4320" value={config.window_height} onChange={e => update({ window_height: Math.max(480, Number(e.target.value)) })} /></div></div>
    <div className="settings-actions"><button onClick={() => void save()} disabled={saving}><Save size={17} />{saving ? (ar ? "جارٍ الحفظ..." : "Saving...") : (ar ? "حفظ الإعدادات" : "Save settings")}</button>{message && <span className="settings-message"><CheckCircle2 size={15} />{message}</span>}</div>
  </section>;
}
