import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, RefreshCw, CheckCircle2, AlertCircle, Download, Loader2 } from "lucide-react";
import type { Language } from "../locales/translations";

type MojangVersion = { id: string; type: "release" | "snapshot" | "old_beta" | "old_alpha"; url: string; releaseTime: string };
type Manifest = { versions: MojangVersion[] };

export default function VersionCatalog({ lang, selectedVersion, onSelect }: {
  lang: Language; selectedVersion: string | null; onSelect: (version: string) => void;
}) {
  const ar = lang === "ar";
  const native = isTauri();
  const [versions, setVersions] = useState<MojangVersion[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "release" | "snapshot">("release");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState("");
  const [installMessage, setInstallMessage] = useState("");
  const [installError, setInstallError] = useState("");
  const [installedVersion, setInstalledVersion] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const manifest = native
        ? await invoke<Manifest>("get_minecraft_version_manifest")
        : await (async () => {
            const response = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", { headers: { Accept: "application/json" } });
            if (!response.ok) throw new Error("Mojang returned HTTP " + response.status);
            return await response.json() as Manifest;
          })();
      if (!Array.isArray(manifest.versions)) throw new Error("Invalid Mojang version manifest");
      setVersions(manifest.versions);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const install = async (version: string) => {
    if (!native) {
      setInstallError(ar ? "التثبيت يحتاج تشغيل نسخة DRAGON المثبتة، وليس معاينة المتصفح." : "Installation requires the installed DRAGON app, not browser preview.");
      return;
    }
    setInstalling(version); setInstallError(""); setInstallMessage(ar ? "بدء تجهيز ملفات اللعبة من خوادم Mojang..." : "Preparing game files from Mojang...");
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ stage: string; done: number; total: number }>("minecraft-install-progress", event => {
        const labels: Record<string, string> = ar
          ? { client: "تم تنزيل ملف اللعبة", libraries: "تنزيل المكتبات", natives: "تجهيز مكتبات النظام الأصلية", assets: "تنزيل أصول اللعبة", complete: "اكتمل تجهيز ملفات الإصدار" }
          : { client: "Client downloaded", libraries: "Downloading libraries", natives: "Extracting native libraries", assets: "Downloading game assets", complete: "Version files prepared" };
        setInstallMessage(labels[event.payload.stage] || event.payload.stage);
      });
      const result = await invoke<{ version: string; game_directory: string; downloaded_bytes: number; libraries: number; natives: number; assets: number }>("install_minecraft_version", { versionId: version });
      setInstalledVersion(version);
      const mb = (result.downloaded_bytes / 1048576).toFixed(1);
      setInstallMessage(ar
        ? "اكتمل تنزيل " + result.version + " (" + mb + " MB) — المكتبات: " + result.libraries + " — الأصول: " + result.assets + ". المجلد: " + result.game_directory
        : "Downloaded " + result.version + " (" + mb + " MB) — libraries: " + result.libraries + " — assets: " + result.assets + ". Folder: " + result.game_directory);
    } catch (e) { setInstallError(e instanceof Error ? e.message : String(e)); setInstallMessage(""); }
    finally { if (unlisten) unlisten(); setInstalling(""); }
  };

  const filtered = useMemo(() => versions.filter(v => {
    const matchesKind = kind === "all" || v.type === kind;
    return matchesKind && v.id.toLowerCase().includes(query.trim().toLowerCase());
  }), [versions, kind, query]);

  return (
    <section className="rounded-2xl border border-dragon-border bg-dragon-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-xl font-bold">{ar ? "إصدارات Minecraft الرسمية" : "Official Minecraft versions"}</h3>
          <p className="mt-1 text-sm text-slate-400">{ar ? "قائمة مباشرة من خوادم Mojang مع تنزيل ملفات الإصدار." : "Live Mojang catalog with version file installation."}</p></div>
        <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-dragon-border px-3 py-2 text-sm hover:border-dragon-accent disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />{ar ? "تحديث" : "Refresh"}
        </button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex items-center gap-2 rounded-xl border border-dragon-border bg-dragon-dark px-3">
          <Search size={17} className="text-slate-500" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={ar ? "ابحث عن إصدار مثل 1.21.11" : "Search version, e.g. 1.21.11"} className="w-full bg-transparent py-3 text-sm outline-none" />
        </label>
        <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 text-sm">
          <option value="release">{ar ? "إصدارات مستقرة" : "Releases"}</option><option value="snapshot">{ar ? "إصدارات تجريبية" : "Snapshots"}</option><option value="all">{ar ? "الكل" : "All types"}</option>
        </select>
      </div>
      {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{ar ? "تعذر الاتصال بكتالوج Mojang:" : "Could not load Mojang catalog:"} {error}</span></div>}
      {installError && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{installError}</span></div>}
      {installMessage && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /><span className="break-all">{installMessage}</span></div>}
      {loading && <p className="py-8 text-center text-sm text-slate-400">{ar ? "جارٍ جلب الإصدارات من Mojang..." : "Loading versions from Mojang..."}</p>}
      {!loading && !error && <>
        <p className="mt-4 text-xs text-slate-500">{ar ? "تم العثور على " + filtered.length + " إصدار" : filtered.length + " versions found"}</p>
        <div className="mt-2 max-h-[460px] space-y-2 overflow-y-auto pe-1">
          {filtered.slice(0, 120).map(v => {
            const active = selectedVersion === v.id;
            return <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dragon-border bg-dragon-dark/70 p-3">
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-bold">{v.id}</span><span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{v.type}</span></div>
                <p className="mt-1 text-xs text-slate-500">{new Date(v.releaseTime).toLocaleDateString(ar ? "ar" : "en")}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => onSelect(v.id)} className={"flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold " + (active ? "bg-emerald-500/15 text-emerald-300" : "bg-dragon-accent text-white hover:bg-rose-600")}>
                  {active ? <CheckCircle2 size={15} /> : null}{active ? (ar ? "محدد" : "Selected") : (ar ? "اختيار" : "Select")}
                </button>
                <button onClick={() => void install(v.id)} disabled={!native || !!installing} title={!native ? (ar ? "يتطلب التطبيق المثبت" : "Requires installed app") : ""}
                  className="flex items-center gap-2 rounded-lg border border-dragon-border px-3 py-2 text-xs font-bold hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
                  {installing === v.id ? <Loader2 size={15} className="animate-spin" /> : installedVersion === v.id ? <CheckCircle2 size={15} /> : <Download size={15} />}
                  {installing === v.id ? (ar ? "جارٍ التثبيت" : "Installing") : installedVersion === v.id ? (ar ? "تم التنزيل" : "Downloaded") : (ar ? "تنزيل وتثبيت" : "Install")}
                </button>
              </div>
            </div>;
          })}
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{ar ? "لا توجد نتائج مطابقة." : "No matching versions."}</p>}
        </div>
      </>}
      <p className="mt-4 border-t border-dragon-border pt-3 text-xs leading-6 text-amber-200/80">{ar
        ? "التثبيت ينزّل ملف اللعبة والمكتبات وأصول اللعبة وملفات النظام الأصلية مع التحقق من SHA-1. لتشغيلها على الكمبيوتر، اضبط مسار Java إن لم يكن متاحاً في PATH وأنشئ حساباً محلياً. يلزم تسجيل Microsoft للعب بالحسابات الرسمية والخوادم المحمية."
        : "Installer downloads the client, libraries, game assets and native files with SHA-1 verification. On desktop, configure Java if it is not available in PATH and create a local profile. Microsoft sign-in is required for official accounts and protected servers."}</p>
    </section>
  );
}
