import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Plus, Trash2, FolderOpen, Gamepad2, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Language } from "../locales/translations";

type GameInstance = { id: string; name: string; version_id: string; created_at: number; game_directory: string };

export default function InstancesPanel({ lang }: { lang: Language }) {
  const ar = lang === "ar";
  const native = isTauri();
  const [items, setItems] = useState<GameInstance[]>([]);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.21.11");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!native) return;
    setLoading(true); setError("");
    try { setItems(await invoke<GameInstance[]>("list_game_instances")); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [native]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!native) { setError(ar ? "إنشاء النسخ يحتاج التطبيق المثبت." : "Creating instances requires the installed app."); return; }
    setBusy("create"); setError(""); setNotice("");
    try {
      const item = await invoke<GameInstance>("create_game_instance", { name, versionId: version });
      setItems(current => [item, ...current]);
      setName("");
      setNotice(ar ? "تم إنشاء النسخة ومجلداتها المستقلة." : "Instance and its dedicated folders were created.");
    } catch (e) { setError(String(e)); }
    finally { setBusy(""); }
  };

  const rename = async (item: GameInstance) => {\n    const next = window.prompt(ar ? "الاسم الجديد للنسخة" : "New instance name", item.name);\n    if (next === null || !next.trim()) return;\n    setBusy(item.id); setError(""); setNotice("");\n    try { const updated = await invoke<GameInstance>("rename_game_instance", { instanceId: item.id, name: next.trim() }); setItems(current => current.map(entry => entry.id === item.id ? updated : entry)); setNotice(ar ? "تم تغيير اسم النسخة." : "Instance renamed."); }\n    catch (e) { setError(String(e)); } finally { setBusy(""); }\n  };\n\n  const openFolder = async (item: GameInstance, folder: string) => {\n    setError(""); try { await invoke("open_instance_folder", { instanceId: item.id, folder }); } catch (e) { setError(String(e)); }\n  };\n\n  const remove = async (item: GameInstance) => {
    if (!window.confirm(ar ? `حذف النسخة «${item.name}» وجميع ملفاتها؟` : `Delete "${item.name}" and all its files?`)) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      await invoke("delete_game_instance", { instanceId: item.id });
      setItems(current => current.filter(entry => entry.id !== item.id));
      setNotice(ar ? "تم حذف النسخة." : "Instance deleted.");
    } catch (e) { setError(String(e)); }
    finally { setBusy(""); }
  };

  return <section className="rounded-2xl border border-dragon-border bg-dragon-panel p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-bold">{ar ? "نسخ Minecraft المستقلة" : "Minecraft Instances"}</h3>
        <p className="mt-1 text-sm text-slate-400">{ar ? "أنشئ ملفات لعب منفصلة لكل إصدار ومجموعة مودات." : "Create separate game folders for each version and mod collection."}</p></div>
      <button onClick={() => void refresh()} disabled={!native || loading} className="flex items-center gap-2 rounded-lg border border-dragon-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/>{ar ? "تحديث" : "Refresh"}</button>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={ar ? "اسم النسخة، مثلاً Survival" : "Instance name, e.g. Survival"} className="min-w-0 rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 text-sm outline-none focus:border-dragon-accent"/>
      <input value={version} onChange={e => setVersion(e.target.value)} maxLength={64} placeholder="1.21.11" className="rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 text-sm outline-none focus:border-dragon-accent"/>
      <button onClick={() => void create()} disabled={busy !== "" || !name.trim() || !version.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-dragon-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><Plus size={17}/>{ar ? "إنشاء نسخة" : "Create instance"}</button>
    </div>
    {error && <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><AlertCircle size={18}/><span>{error}</span></div>}
    {notice && <div role="status" className="mt-4 flex gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 size={18}/>{notice}</div>}
    {!native && <p className="mt-4 text-sm text-amber-300">{ar ? "المعاينة تعرض الواجهة فقط؛ إدارة الملفات تتطلب التطبيق المثبت." : "Preview mode only; file management requires the installed app."}</p>}
    <div className="mt-5 space-y-3">
      {items.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dragon-border bg-dragon-dark p-4">
        <div className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-dragon-accent/10 p-3 text-dragon-accent"><Gamepad2 size={21}/></span><div className="min-w-0"><h4 className="font-bold">{item.name}</h4><p className="text-sm text-slate-400">{item.version_id}</p><p className="mt-1 break-all text-xs text-slate-500">{item.game_directory}</p></div></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => void openFolder(item, "")} disabled={busy !== ""} className="flex items-center gap-2 rounded-lg border border-dragon-border px-3 py-2 text-sm"><FolderOpen size={15}/>{ar ? "فتح المجلد" : "Open folder"}</button><button onClick={() => void rename(item)} disabled={busy !== ""} className="rounded-lg border border-dragon-border px-3 py-2 text-sm">{ar ? "إعادة تسمية" : "Rename"}</button><button onClick={() => void remove(item)} disabled={busy !== ""} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 disabled:opacity-50"><Trash2 size={15}/>{busy === item.id ? (ar ? "جارٍ الحذف..." : "Deleting...") : (ar ? "حذف" : "Delete")}</button></div>
      </article>)}
      {!loading && items.length === 0 && <div className="rounded-xl border border-dashed border-dragon-border p-8 text-center text-sm text-slate-400">{ar ? "لا توجد نسخ بعد. أنشئ أول نسخة من الأعلى." : "No instances yet. Create your first one above."}</div>}
    </div>
  </section>;
}
