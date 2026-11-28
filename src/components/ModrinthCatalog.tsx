import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, Download, RefreshCw, Package, Blocks, ExternalLink, CheckCircle2, AlertCircle, FileUp, SlidersHorizontal } from "lucide-react";
import type { Language } from "../locales/translations";

type Hit = { project_id: string; slug: string; title: string; description: string; downloads: number; follows?: number; icon_url?: string; date_modified?: string; };
type SearchResponse = { hits: Hit[]; total_hits?: number; };
type ModFile = { url: string; filename: string; primary?: boolean; };
type Dependency = { project_id?: string | null; version_id?: string | null; dependency_type?: "required" | "optional" | "incompatible" | "embedded" | null; };
type ProjectVersion = { id: string; project_id?: string; name: string; version_number: string; files: ModFile[]; dependencies?: Dependency[]; };
type InstalledMod = { filename: string; enabled: boolean; bytes: number };
type DownloadProgress = { downloadId: string; received: number; total: number };

const CATEGORIES = [
  { id: "optimization", ar: "تحسين الأداء", en: "Optimization" },
  { id: "utility", ar: "أدوات ومساعدات", en: "Utility" },
  { id: "equipment", ar: "قتال وPvP", en: "Combat / PvP" },
  { id: "adventure", ar: "العالم والمغامرات", en: "Adventure" },
  { id: "decoration", ar: "إضافات بصرية", en: "Visuals" },
  { id: "worldgen", ar: "توليد العالم", en: "World generation" },
  { id: "technology", ar: "تقنيات", en: "Technology" },
];

export default function ModrinthCatalog({ lang, kind, instanceId, initialVersion, initialLoader }: {
  lang: Language; kind: "mod" | "modpack"; instanceId?: string | null; initialVersion?: string; initialLoader?: string;
}) {
  const ar = lang === "ar";
  const native = isTauri();
  const [query, setQuery] = useState("");
  const [gameVersion, setGameVersion] = useState(initialVersion || "1.21.11");
  const [loader, setLoader] = useState(initialLoader || "fabric");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("downloads");
  const [hits, setHits] = useState<Hit[]>([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<{ id: string; percent: number | null; label: string } | null>(null);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const externalFileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  const refreshInstalled = async () => {
    if (!native || kind !== "mod") { setInstalled([]); return; }
    try { setInstalled(await invoke<InstalledMod[]>("list_installed_mods", { instanceId: instanceId ?? null })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    if (initialVersion) setGameVersion(initialVersion);
    if (initialLoader) setLoader(initialLoader);
  }, [initialVersion, initialLoader]);

  useEffect(() => { void refreshInstalled(); }, [native, kind, instanceId]);

  useEffect(() => {
    if (!native) return;
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("mod-download-progress", event => {
      const item = event.payload;
      setProgress(current => current?.id === item.downloadId
        ? { ...current, percent: item.total > 0 ? Math.min(100, Math.round(item.received / item.total * 100)) : null }
        : current);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [native]);

  const search = async (append = false) => {
    const requestId = ++requestRef.current;
    const offset = append ? pageOffset : 0;
    setLoading(true); setError("");
    try {
      const facets: string[][] = [[`project_type:${kind}`]];
      if (gameVersion.trim()) facets.push([`versions:${gameVersion.trim()}`]);
      if (kind === "mod" && loader !== "any") facets.push([`categories:${loader}`]);
      if (category) facets.push([`categories:${category}`]);
      const params = new URLSearchParams({ limit: "50", offset: String(offset), index: sort, facets: JSON.stringify(facets) });
      if (query.trim()) params.set("query", query.trim());
      const response = await fetch(`https://api.modrinth.com/v2/search?${params.toString()}`);
      if (!response.ok) throw new Error(`Modrinth HTTP ${response.status}`);
      const data = await response.json() as SearchResponse;
      if (requestId !== requestRef.current) return;
      const page = Array.isArray(data.hits) ? data.hits : [];
      setHits(previous => append ? [...previous, ...page.filter(item => !previous.some(old => old.project_id === item.project_id))] : page);
      setPageOffset(offset + page.length);
      setTotalHits(typeof data.total_hits === "number" ? data.total_hits : offset + page.length);
    } catch (e) { if (requestId === requestRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (requestId === requestRef.current) setLoading(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { setPageOffset(0); setTotalHits(0); void search(false); }, 300);
    return () => window.clearTimeout(timer);
  }, [query, gameVersion, loader, kind, category, sort]);

  const getCompatibleVersion = async (projectId: string, versionId?: string | null): Promise<ProjectVersion> => {
    if (versionId) {
      const response = await fetch(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
      if (!response.ok) throw new Error(`Could not load dependency version (${response.status})`);
      return await response.json() as ProjectVersion;
    }
    const params = new URLSearchParams();
    if (gameVersion.trim()) params.set("game_versions", JSON.stringify([gameVersion.trim()]));
    if (loader !== "any") params.set("loaders", JSON.stringify([loader]));
    const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params.toString()}`);
    if (!response.ok) throw new Error(`Could not load compatible versions (${response.status})`);
    const versions = await response.json() as ProjectVersion[];
    const selected = versions.find(v => v.files?.some(file => file.primary)) ?? versions.find(v => v.files?.length);
    if (!selected) throw new Error(ar ? "لم يتم العثور على إصدار متوافق لأحد المتطلبات." : "No compatible version was found for a dependency.");
    return selected;
  };

  const downloadVersion = async (version: ProjectVersion, projectId: string, label: string) => {
    const file = version.files?.find(f => f.primary) ?? version.files?.[0];
    if (!file) throw new Error(ar ? "لا يوجد ملف تنزيل لهذا الإصدار." : "No downloadable file exists for this version.");
    const downloadId = `${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setProgress({ id: downloadId, percent: 0, label });
    await invoke<string>("download_modrinth_file", {
      url: file.url, filename: file.filename, kind, instanceId: instanceId ?? null, downloadId
    });
    setProgress(current => current?.id === downloadId ? { ...current, percent: 100 } : current);
  };

  const download = async (project: Hit) => {
    if (!native) { setNotice(ar ? "التنزيل إلى مجلد النسخة يتطلب تشغيل التطبيق المثبت." : "Downloading into the selected instance requires the installed app."); return; }
    if (kind === "mod" && !instanceId) {
      setNotice(ar ? "لم تحدد نسخة لعبة؛ سيتم الحفظ في مجلد اللعبة العام." : "No game instance selected; the mod will be saved to the shared game folder.");
    }
    setBusyId(project.project_id); setNotice(""); setError(""); setProgress(null);
    try {
      const version = await getCompatibleVersion(project.project_id);
      const required = (version.dependencies ?? []).filter(dep => dep.dependency_type === "required" && (dep.project_id || dep.version_id));
      const dependencyVersions: Array<{ version: ProjectVersion; projectId: string }> = [];
      const seen = new Set<string>([project.project_id]);
      for (const dep of required) {
        const key = dep.project_id || dep.version_id || "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const depVersion = await getCompatibleVersion(dep.project_id || "", dep.version_id);
        dependencyVersions.push({ version: depVersion, projectId: depVersion.project_id || dep.project_id || key });
      }
      if (dependencyVersions.length > 0) {
        const names = dependencyVersions.map(item => item.version.name || item.projectId).join(", ");
        const accepted = window.confirm(ar
          ? `هذا المود يحتاج إلى متطلبات إضافية:\n${names}\n\nهل تريد تنزيلها تلقائياً؟`
          : `This mod requires additional dependencies:\n${names}\n\nDownload them automatically?`);
        if (!accepted) { setNotice(ar ? "ألغيت العملية لأن المتطلبات لم تُثبت." : "Install cancelled because required dependencies were not accepted."); return; }
      }
      for (const dep of dependencyVersions) await downloadVersion(dep.version, dep.projectId, ar ? `تنزيل المتطلب: ${dep.version.name}` : `Downloading dependency: ${dep.version.name}`);
      await downloadVersion(version, project.project_id, ar ? `تنزيل ${project.title}` : `Downloading ${project.title}`);
      setNotice(ar ? "اكتمل تنزيل المود ومتطلباته." : "The mod and its required dependencies were downloaded.");
      await refreshInstalled();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(""); window.setTimeout(() => setProgress(null), 1800); }
  };

  const importExternal = async (file?: File) => {
    if (!file) return;
    if (!native) { setError(ar ? "استيراد الملفات يتطلب التطبيق المثبت." : "Importing files requires the installed app."); return; }
    if (!file.name.toLowerCase().endsWith(".jar") || file.size > 100 * 1024 * 1024) {
      setError(ar ? "اختر ملف مود .jar لا يتجاوز 100 MB." : "Choose a .jar mod file no larger than 100 MB."); return;
    }
    setBusyId("external"); setError(""); setNotice(""); setProgress({ id: "external", percent: 0, label: file.name });
    try {
      const reader = new FileReader();
      const dataBase64: string = await new Promise((resolve, reject) => {
        reader.onprogress = event => { if (event.lengthComputable) setProgress({ id: "external", percent: Math.round(event.loaded / event.total * 100), label: file.name }); };
        reader.onerror = () => reject(reader.error || new Error("Could not read selected file"));
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
        };
        reader.readAsDataURL(file);
      });
      const path = await invoke<string>("import_external_mod", { filename: file.name, dataBase64, instanceId: instanceId ?? null });
      setNotice((ar ? "تم استيراد المود إلى: " : "Imported mod to: ") + path);
      await refreshInstalled();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(""); window.setTimeout(() => setProgress(null), 1800); }
  };

  const installedMatch = (project: Hit) => installed.find(mod => mod.filename.toLowerCase().includes(project.slug.toLowerCase()) && mod.enabled);
  return <section className="feature-page">
    <div className="feature-intro"><div className="feature-symbol">{kind === "mod" ? <Blocks size={25} /> : <Package size={25} />}</div><div><h3>{kind === "mod" ? (ar ? "استكشاف المودات" : "Explore mods") : (ar ? "استكشاف حزم المودات" : "Explore modpacks")}</h3><p>{ar ? "بحث مباشر مع فلترة ذكية وتنزيل داخل مجلد النسخة المحددة." : "Live discovery, smart filters and downloads into the selected game instance."}</p></div></div>
    {kind === "mod" && <div className="settings-actions"><button onClick={() => externalFileRef.current?.click()} disabled={busyId === "external"}><FileUp size={16}/>{ar ? "استيراد مود من الجهاز" : "Import mod from device"}</button><input ref={externalFileRef} type="file" accept=".jar,application/java-archive" hidden onChange={e => { void importExternal(e.target.files?.[0]); e.currentTarget.value = ""; }} /></div>}
    <div className="modrinth-filters">
      <label className="modrinth-search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={ar ? "ابحث باسم المود..." : "Search mods..."} /><button onClick={() => { setPageOffset(0); void search(false); }} aria-label={ar ? "بحث" : "Search"}><RefreshCw size={16} /></button></label>
      <div className="modrinth-filter-row">
        <label><span>{ar ? "إصدار اللعبة" : "Game version"}</span><input value={gameVersion} onChange={e => setGameVersion(e.target.value)} placeholder="1.21.11" /></label>
        {kind === "mod" && <label><span>{ar ? "المشغل" : "Loader"}</span><select value={loader} onChange={e => setLoader(e.target.value)}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option><option value="any">{ar ? "الكل" : "Any"}</option></select></label>}
        <label><span><SlidersHorizontal size={13}/>{ar ? "ترتيب النتائج" : "Sort by"}</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="downloads">{ar ? "الأكثر تحميلاً" : "Most downloaded"}</option><option value="updated">{ar ? "آخر تحديث" : "Recently updated"}</option><option value="newest">{ar ? "الأحدث" : "Newest"}</option><option value="follows">{ar ? "الأكثر متابعة" : "Most followed"}</option><option value="relevance">{ar ? "الأكثر صلة" : "Relevance"}</option></select></label>
      </div>
      {kind === "mod" && <div className="mod-category-row" aria-label={ar ? "تصنيفات المودات" : "Mod categories"}><button className={!category ? "selected" : ""} onClick={() => setCategory("")}>{ar ? "الكل" : "All"}</button>{CATEGORIES.map(item => <button key={item.id} className={category === item.id ? "selected" : ""} onClick={() => setCategory(category === item.id ? "" : item.id)}>{ar ? item.ar : item.en}</button>)}</div>}
    </div>
    {error && <div className="feature-callout mod-error"><AlertCircle size={17} />{error}</div>}
    {notice && <div className="feature-callout mod-success"><CheckCircle2 size={17} />{notice}</div>}
    {progress && <div className="mod-download-progress"><div><span>{progress.label}</span><strong>{progress.percent === null ? (ar ? "جارٍ التنزيل…" : "Downloading…") : `${progress.percent}%`}</strong></div><div className="mod-progress-track"><span style={{ width: progress.percent === null ? "35%" : `${progress.percent}%` }} /></div></div>}
    <div className="mod-results-heading"><strong>{ar ? "نتائج Modrinth" : "Modrinth results"}</strong><span>{loading ? (ar ? "جارٍ البحث..." : "Searching...") : `${hits.length} / ${totalHits}`}</span></div>
    {loading && <div className="feature-empty">{ar ? "جارٍ تحميل النتائج..." : "Loading results..."}</div>}
    {!loading && hits.length === 0 && !error && <div className="feature-empty">{ar ? "لا توجد نتائج. جرّب تغيير البحث أو الفلاتر." : "No results. Try changing your search or filters."}</div>}
    <div className="mod-result-list">{hits.map(project => {
      const installedMod = installedMatch(project);
      return <article className="mod-result" key={project.project_id}>
        {project.icon_url ? <img src={project.icon_url} alt="" loading="lazy" /> : <div className="mod-result-placeholder"><Package size={20} /></div>}
        <div className="mod-result-copy"><strong>{project.title}</strong><p>{project.description}</p><div className="mod-card-meta"><small><Download size={11}/>{project.downloads.toLocaleString()}</small>{project.date_modified && <small>{ar ? "تحديث " : "Updated "}{new Date(project.date_modified).toLocaleDateString(ar ? "ar" : "en")}</small>}{typeof project.follows === "number" && <small>{project.follows.toLocaleString()} {ar ? "متابعة" : "followers"}</small>}</div></div>
        <div className="mod-result-actions"><button className={installedMod ? "is-installed" : ""} disabled={busyId === project.project_id || !!installedMod} onClick={() => void download(project)}>{installedMod ? <CheckCircle2 size={15}/> : <Download size={15} />}{busyId === project.project_id ? "…" : installedMod ? (ar ? "مثبت" : "Installed") : (ar ? "تثبيت" : "Install")}</button><a href={`https://modrinth.com/${kind}/${project.slug}`} target="_blank" rel="noreferrer" aria-label={ar ? "فتح Modrinth" : "Open Modrinth"}><ExternalLink size={15} /></a></div>
      </article>;
    })}</div>
    {!loading && hits.length < totalHits && <div className="settings-actions"><button onClick={() => void search(true)}>{ar ? "تحميل المزيد" : "Load more"}</button></div>}
    <p className="feature-footnote">{ar ? "المودات تحفظ داخل مجلد mods للنسخة المختارة. ترتيب التقييم غير متاح في فهرس Modrinth؛ لذلك وفرنا الأكثر متابعة بدلاً من عرض تقييم غير حقيقي." : "Mods are saved in the selected instance's mods folder. Modrinth does not expose a rating sort in its search index, so Most followed is provided instead of a fabricated rating."}</p>
  </section>;
}
