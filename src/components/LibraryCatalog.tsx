import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Blocks, Package, RefreshCw, FileUp, Download, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Language } from "../locales/translations";
import ModrinthCatalog from "./ModrinthCatalog";

type ContentItem = { name: string; path: string; size: number; directory: boolean; source: string };
type View = "browse-mods" | "browse-packs" | "downloaded-mods" | "downloaded-resourcepacks";

export default function LibraryCatalog({ lang, instanceId }: { lang: Language; instanceId: string | null }) {
  const ar = lang === "ar";
  const native = isTauri();
  const [view, setView] = useState<View>("browse-mods");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!native || (view !== "downloaded-mods" && view !== "downloaded-resourcepacks")) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const folder = view === "downloaded-mods" ? "mods" : "resourcepacks";
      const result = await invoke<ContentItem[]>("list_downloaded_game_content", { folder, instanceId });
      setItems(result);
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [native, view, instanceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const importResourcePack = async (file?: File) => {
    if (!file) return;
    if (!native) {
      setError(ar ? "استيراد حزم الموارد يحتاج التطبيق المثبت." : "Importing resource packs requires the installed app.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip") || file.size > 256 * 1024 * 1024) {
      setError(ar ? "اختر حزمة موارد بصيغة ZIP لا يتجاوز حجمها 256 MB." : "Choose a ZIP resource pack no larger than 256 MB.");
      return;
    }
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const path = await invoke<string>("import_external_resourcepack", {
        filename: file.name,
        dataBase64: btoa(binary),
        instanceId
      });
      setNotice((ar ? "تم استيراد حزمة الموارد: " : "Resource pack imported: ") + path);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sizeLabel = (bytes: number) => bytes <= 0 ? (ar ? "مجلد" : "Folder") : bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(1) + " KB"
    : (bytes / 1048576).toFixed(1) + " MB";

  const tabs: { id: View; label: string; icon: typeof Blocks }[] = [
    { id: "browse-mods", label: ar ? "استكشاف المودات" : "Browse mods", icon: Blocks },
    { id: "browse-packs", label: ar ? "حزم المودات" : "Modpacks", icon: Package },
    { id: "downloaded-mods", label: ar ? "المودات المحمّلة" : "Downloaded mods", icon: Download },
    { id: "downloaded-resourcepacks", label: ar ? "الريسوس باكات" : "Resource packs", icon: Package }
  ];

  return <div className="library-page">
    <div className="settings-actions library-switch" role="tablist" aria-label={ar ? "مكتبة المودات" : "Mods library"}>
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={view === id}
        className={view === id ? "active" : ""} onClick={() => { setView(id); setError(""); setNotice(""); }}>
        <Icon size={16} />{label}
      </button>)}
    </div>

    {(view === "browse-mods" || view === "browse-packs") && (
      <ModrinthCatalog key={view} lang={lang} kind={view === "browse-mods" ? "mod" : "modpack"} instanceId={instanceId} />
    )}

    {(view === "downloaded-mods" || view === "downloaded-resourcepacks") && <section className="feature-page">
      <div className="feature-intro">
        <div className="feature-symbol">{view === "downloaded-mods" ? <Blocks size={25} /> : <Package size={25} />}</div>
        <div><h3>{view === "downloaded-mods" ? (ar ? "المودات المحمّلة" : "Downloaded mods") : (ar ? "الريسوس باكات المحمّلة" : "Downloaded resource packs")}</h3>
          <p>{ar ? "اعرض الملفات الموجودة فعلياً في مجلد اللعبة والنسخة المحددة." : "View files physically stored in the game folder and selected instance."}</p></div>
      </div>
      <div className="settings-actions">
        {view === "downloaded-resourcepacks" && <>
          <button onClick={() => fileRef.current?.click()} disabled={!native || importing}><FileUp size={16}/>{importing ? (ar ? "جارٍ الاستيراد..." : "Importing...") : (ar ? "استيراد ريسوس باك من الجهاز" : "Import resource pack")}</button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={e => { void importResourcePack(e.target.files?.[0]); }} />
        </>}
        <button onClick={() => void refresh()} disabled={!native || loading}><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>{ar ? "تحديث القائمة" : "Refresh list"}</button>
      </div>
      {!instanceId && <p className="feature-footnote">{ar ? "لا توجد نسخة محددة؛ ستظهر الملفات الموجودة في مجلد اللعبة العام. اختر نسخة لعرض ملفاتها المستقلة أيضاً." : "No instance selected; showing files in the shared game folder. Select an instance to include its private files."}</p>}
      {error && <div className="feature-callout mod-error"><AlertCircle size={17}/>{error}</div>}
      {notice && <div className="feature-callout mod-success"><CheckCircle2 size={17}/>{notice}</div>}
      <div className="mod-results-heading"><strong>{ar ? "الملفات الموجودة على الجهاز" : "Files on this device"}</strong><span>{loading ? (ar ? "جارٍ الفحص..." : "Scanning...") : items.length}</span></div>
      {loading && <div className="feature-empty">{ar ? "جارٍ قراءة مجلدات اللعبة..." : "Reading game folders..."}</div>}
      {!loading && items.length === 0 && !error && <div className="feature-empty">{view === "downloaded-mods" ? (ar ? "لم يتم العثور على مودات محمّلة بعد." : "No downloaded mods found yet.") : (ar ? "لم يتم العثور على ريسوس باكات بعد. استورد ملف ZIP من جهازك." : "No resource packs found yet. Import a ZIP file from your device.")}</div>}
      <div className="mod-result-list">{items.map(item => <article className="mod-result" key={item.path}>
        <div className="mod-result-placeholder">{view === "downloaded-mods" ? <Blocks size={20}/> : <Package size={20}/>}</div>
        <div className="mod-result-copy min-w-0"><strong className="break-all">{item.name}</strong><p>{sizeLabel(item.size)} · {item.source.startsWith("instance:") ? (ar ? "نسخة مستقلة" : "Instance") : (ar ? "مجلد اللعبة العام" : "Shared game folder")}</p><small className="break-all">{item.path}</small></div>
      </article>)}</div>
    </section>}
  </div>;
}
