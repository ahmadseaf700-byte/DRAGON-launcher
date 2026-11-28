import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Blocks, Package, CheckCircle2, Power, RefreshCw, Trash2, AlertCircle } from "lucide-react";
import type { Language } from "../locales/translations";
import ModrinthCatalog from "./ModrinthCatalog";

type InstalledMod = { filename: string; enabled: boolean; bytes: number };

function InstalledModsPanel({ lang, instanceId }: { lang: Language; instanceId?: string | null }) {
  const ar = lang === "ar";
  const native = isTauri();
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!native) return;
    setLoading(true); setError("");
    try { setMods(await invoke<InstalledMod[]>("list_installed_mods", { instanceId: instanceId ?? null })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [native, instanceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = async (mod: InstalledMod) => {
    setBusy(mod.filename); setError(""); setNotice("");
    try {
      await invoke<string>("set_mod_enabled", { instanceId: instanceId ?? null, filename: mod.filename, enabled: !mod.enabled });
      setNotice(ar ? "تم تحديث حالة المود." : "Mod state updated.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const remove = async (mod: InstalledMod) => {
    const accepted = window.confirm(ar ? `هل تريد حذف ${mod.filename} نهائياً؟` : `Permanently delete ${mod.filename}?`);
    if (!accepted) return;
    setBusy(mod.filename); setError(""); setNotice("");
    try {
      await invoke("delete_installed_mod", { instanceId: instanceId ?? null, filename: mod.filename });
      setNotice(ar ? "تم حذف المود." : "Mod deleted.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  if (!native) return <div className="feature-empty">{ar ? "إدارة المودات المثبتة تتطلب تشغيل التطبيق المثبت." : "Installed mod management requires the installed app."}</div>;
  return <section className="feature-page">
    <div className="feature-intro"><div className="feature-symbol"><Blocks size={25}/></div><div><h3>{ar ? "المودات المثبتة" : "Installed mods"}</h3><p>{ar ? "فعّل المودات أو عطّلها أو احذفها من مجلد النسخة المحددة." : "Enable, disable or remove mods in the selected game instance."}</p></div><button className="mod-refresh-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15}/>{ar ? "تحديث" : "Refresh"}</button></div>
    {!instanceId && <div className="feature-callout">{ar ? "لم تحدد نسخة مستقلة؛ تعرض هذه القائمة مودات مجلد اللعبة العام." : "No separate instance selected; showing mods in the shared game folder."}</div>}
    {error && <div className="feature-callout mod-error"><AlertCircle size={16}/>{error}</div>}
    {notice && <div className="feature-callout mod-success"><CheckCircle2 size={16}/>{notice}</div>}
    {loading && <div className="feature-empty">{ar ? "جارٍ قراءة ملفات المودات..." : "Reading mod files..."}</div>}
    {!loading && mods.length === 0 && <div className="feature-empty">{ar ? "لا توجد مودات مثبتة حالياً." : "No installed mods were found."}</div>}
    <div className="installed-mod-list">{mods.map(mod => <article className={`installed-mod-card ${mod.enabled ? "" : "disabled"}`} key={mod.filename}>
      <div className="installed-mod-icon"><Package size={19}/></div>
      <div className="installed-mod-copy"><strong>{mod.filename}</strong><small>{formatBytes(mod.bytes)} · {mod.enabled ? (ar ? "مفعّل" : "Enabled") : (ar ? "معطّل" : "Disabled")}</small></div>
      <button className={mod.enabled ? "mod-toggle-button active" : "mod-toggle-button"} disabled={busy === mod.filename} onClick={() => void toggle(mod)}><Power size={14}/>{busy === mod.filename ? "…" : mod.enabled ? (ar ? "تعطيل" : "Disable") : (ar ? "تفعيل" : "Enable")}</button>
      <button className="mod-delete-button" disabled={busy === mod.filename} onClick={() => void remove(mod)} aria-label={ar ? "حذف المود" : "Delete mod"}><Trash2 size={15}/></button>
    </article>)}</div>
    <p className="feature-footnote">{ar ? "التعطيل يغيّر امتداد الملف إلى .jar.disabled دون حذفه. لن تتغير حالة المودات داخل اللعبة حتى إعادة تشغيلها." : "Disabling renames the file to .jar.disabled without deleting it. Changes take effect after restarting Minecraft."}</p>
  </section>;
}

export default function LibraryCatalog({ lang, instanceId, instanceVersion, instanceLoader }: {
  lang: Language; instanceId?: string | null; instanceVersion?: string | null; instanceLoader?: string;
}) {
  const [view, setView] = useState<"mod" | "modpack" | "installed">("mod");
  const ar = lang === "ar";
  return <div className="library-page">
    <div className="settings-actions library-switch" role="tablist" aria-label={ar ? "محتوى المكتبة" : "Library content"}>
      <button role="tab" aria-selected={view === "mod"} className={view === "mod" ? "active" : ""} onClick={() => setView("mod")}><Blocks size={16}/>{ar ? "المودات" : "Mods"}</button>
      <button role="tab" aria-selected={view === "modpack"} className={view === "modpack" ? "active" : ""} onClick={() => setView("modpack")}><Package size={16}/>{ar ? "حزم المودات" : "Modpacks"}</button>
      <button role="tab" aria-selected={view === "installed"} className={view === "installed" ? "active" : ""} onClick={() => setView("installed")}><CheckCircle2 size={16}/>{ar ? "المثبتة" : "Installed"}</button>
    </div>
    {view === "installed"
      ? <InstalledModsPanel lang={lang} instanceId={instanceId}/>
      : <ModrinthCatalog key={view} lang={lang} kind={view} instanceId={instanceId} initialVersion={instanceVersion} initialLoader={instanceLoader}/>}
  </div>;
}
