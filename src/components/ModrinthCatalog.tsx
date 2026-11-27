import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Search, Download, RefreshCw, Package, Blocks, ExternalLink, CheckCircle2, AlertCircle, FileUp } from "lucide-react";
import type { Language } from "../locales/translations";

type Hit = { project_id: string; slug: string; title: string; description: string; downloads: number; icon_url?: string; versions?: string[] };
type SearchResponse = { hits: Hit[] };
type ProjectVersion = { name: string; version_number: string; files: { url: string; filename: string; primary?: boolean }[] };

export default function ModrinthCatalog({ lang, kind }: { lang: Language; kind: "mod" | "modpack" }) {
  const ar = lang === "ar";
  const native = isTauri();
  const [query, setQuery] = useState("");
  const [gameVersion, setGameVersion] = useState("1.21.11");
  const [loader, setLoader] = useState("fabric");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");\n  const externalFileRef = useRef<HTMLInputElement>(null);

  const search = async () => {
    setLoading(true); setError("");
    try {
      const facets: string[][] = [[`project_type:${kind}`]];
      if (gameVersion.trim()) facets.push([`versions:${gameVersion.trim()}`]);
      if (kind === "mod" && loader !== "any") facets.push([`categories:${loader}`]);
      const params = new URLSearchParams({ limit: "30", index: "relevance", facets: JSON.stringify(facets) });
      if (query.trim()) params.set("query", query.trim());
      const response = await fetch(`https://api.modrinth.com/v2/search?${params.toString()}`);
      if (!response.ok) throw new Error(`Modrinth HTTP ${response.status}`);
      const data = await response.json() as SearchResponse;
      setHits(Array.isArray(data.hits) ? data.hits : []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void search(); }, 350);
    return () => window.clearTimeout(timer);
  }, [query, gameVersion, loader, kind]);

  const download = async (project: Hit) => {
    if (!native) { setNotice(ar ? "التنزيل إلى مجلد اللانشر يتطلب تشغيل التطبيق المثبت، وليس معاينة المتصفح." : "Downloading into the launcher folder requires the installed desktop/mobile app, not browser preview."); return; }
    setBusyId(project.project_id); setNotice(""); setError("");
    try {
      const params = new URLSearchParams();
      if (gameVersion.trim()) params.set("game_versions", JSON.stringify([gameVersion.trim()]));
      if (kind === "mod" && loader !== "any") params.set("loaders", JSON.stringify([loader]));
      const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(project.project_id)}/version?${params.toString()}`);
      if (!response.ok) throw new Error(`Could not load project versions (HTTP ${response.status})`);
      const versions = await response.json() as ProjectVersion[];
      const selected = versions.find(v => v.files?.some(f => f.primary)) ?? versions.find(v => v.files?.length);
      const file = selected?.files?.find(f => f.primary) ?? selected?.files?.[0];
      if (!file) throw new Error(ar ? "لا يوجد ملف متوافق لهذا الإصدار والمشغل." : "No compatible file was found for this game version and loader.");
      const path = await invoke<string>("download_modrinth_file", { url: file.url, filename: file.filename, kind });
      setNotice((ar ? "تم الحفظ في: " : "Saved to: ") + path);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(""); }
  };

  const importExternal = async (file?: File) => {
    if (!file) return;
    if (!native) { setError(ar ? "استيراد الملفات إلى مجلد اللعبة يتطلب التطبيق المثبت." : "Importing into the game folder requires the installed app."); return; }
    if (!file.name.toLowerCase().endsWith(".jar") || file.size > 100 * 1024 * 1024) {
      setError(ar ? "اختر ملف مود .jar لا يتجاوز 100 MB." : "Choose a .jar mod file no larger than 100 MB."); return;
    }
    setBusyId("external"); setError(""); setNotice("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const dataBase64 = btoa(binary);
      const path = await invoke<string>("import_external_mod", { filename: file.name, dataBase64 });
      setNotice((ar ? "تم استيراد المود إلى: " : "Imported mod to: ") + path);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(""); }
  };

  return <section className="feature-page">
    <div className="feature-intro"><div className="feature-symbol">{kind === "mod" ? <Blocks size={25} /> : <Package size={25} />}</div><div><h3>{kind === "mod" ? (ar ? "استكشاف المودات" : "Explore mods") : (ar ? "استكشاف حزم المودات" : "Explore modpacks")}</h3><p>{ar ? "بحث مباشر في فهرس Modrinth الرسمي مع تنزيل الملفات المتوافقة إلى مجلد اللانشر." : "Search the official Modrinth index and download compatible files into the launcher folder."}</p></div></div>
    {kind === "mod" && <div className="settings-actions"><button onClick={() => externalFileRef.current?.click()} disabled={busyId === "external"}><FileUp size={16}/>{ar ? "استيراد مود من الجهاز" : "Import mod from device"}</button><input ref={externalFileRef} type="file" accept=".jar,application/java-archive" hidden onChange={e => { void importExternal(e.target.files?.[0]); e.currentTarget.value = ""; }} /></div>}
    <div className="modrinth-filters">
      <label className="modrinth-search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={ar ? "ابحث بالاسم..." : "Search by name..."} /><button onClick={() => void search()} aria-label={ar ? "بحث" : "Search"}><RefreshCw size={16} /></button></label>
      <div className="modrinth-filter-row"><label><span>{ar ? "إصدار اللعبة" : "Game version"}</span><input value={gameVersion} onChange={e => setGameVersion(e.target.value)} placeholder="1.21.11" /></label>{kind === "mod" && <label><span>{ar ? "المشغل" : "Loader"}</span><select value={loader} onChange={e => setLoader(e.target.value)}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option><option value="any">{ar ? "الكل" : "Any"}</option></select></label>}</div>
    </div>
    {error && <div className="feature-callout mod-error"><AlertCircle size={17} />{error}</div>}
    {notice && <div className="feature-callout mod-success"><CheckCircle2 size={17} />{notice}</div>}
    <div className="mod-results-heading"><strong>{ar ? "نتائج Modrinth" : "Modrinth results"}</strong><span>{loading ? (ar ? "جارٍ البحث..." : "Searching...") : hits.length}</span></div>
    {loading && <div className="feature-empty">{ar ? "جارٍ تحميل النتائج..." : "Loading results..."}</div>}
    {!loading && hits.length === 0 && !error && <div className="feature-empty">{ar ? "لا توجد نتائج. جرّب تغيير البحث أو الفلاتر." : "No results. Try changing your search or filters."}</div>}
    <div className="mod-result-list">{hits.map(project => <article className="mod-result" key={project.project_id}>{project.icon_url ? <img src={project.icon_url} alt="" loading="lazy" /> : <div className="mod-result-placeholder"><Package size={20} /></div>}<div className="mod-result-copy"><strong>{project.title}</strong><p>{project.description}</p><small>{project.downloads.toLocaleString()} {ar ? "تنزيل" : "downloads"}</small></div><div className="mod-result-actions"><button disabled={busyId === project.project_id} onClick={() => void download(project)}><Download size={15} />{busyId === project.project_id ? "…" : (ar ? "تنزيل" : "Download")}</button><a href={`https://modrinth.com/${kind}/${project.slug}`} target="_blank" rel="noreferrer" aria-label={ar ? "فتح Modrinth" : "Open Modrinth"}><ExternalLink size={15} /></a></div></article>)}</div>
    <p className="feature-footnote">{ar ? "ملفات المودات تحفظ في مجلد mods، وحزم المودات تحفظ كملفات .mrpack في مجلد modpacks. يلزم تثبيت المشغل المناسب قبل تشغيل المود." : "Mods are saved in the mods folder; modpacks are saved as .mrpack files in modpacks. The matching mod loader must be installed before launching."}</p>
  </section>;
}
