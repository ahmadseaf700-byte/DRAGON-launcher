import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import type { Language } from "../locales/translations";

type MojangVersion = {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  url: string;
  releaseTime: string;
};

type Manifest = { versions: MojangVersion[] };

export default function VersionCatalog({ lang, selectedVersion, onSelect }: {
  lang: Language;
  selectedVersion: string | null;
  onSelect: (version: string) => void;
}) {
  const ar = lang === "ar";
  const [versions, setVersions] = useState<MojangVersion[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "release" | "snapshot">("release");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Mojang returned HTTP ${response.status}`);
      const manifest = await response.json() as Manifest;
      if (!Array.isArray(manifest.versions)) throw new Error("Invalid Mojang version manifest");
      setVersions(manifest.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => versions.filter(v => {
    const matchesKind = kind === "all" || v.type === kind;
    return matchesKind && v.id.toLowerCase().includes(query.trim().toLowerCase());
  }), [versions, kind, query]);

  return (
    <section className="rounded-2xl border border-dragon-border bg-dragon-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{ar ? "إصدارات Minecraft الرسمية" : "Official Minecraft versions"}</h3>
          <p className="mt-1 text-sm text-slate-400">{ar ? "القائمة مباشرة من خوادم Mojang، وليست قائمة تجريبية." : "Live catalog from Mojang servers, not a demo list."}</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-dragon-border px-3 py-2 text-sm hover:border-dragon-accent disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />{ar ? "تحديث" : "Refresh"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex items-center gap-2 rounded-xl border border-dragon-border bg-dragon-dark px-3">
          <Search size={17} className="text-slate-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={ar ? "ابحث عن إصدار مثل 1.21.11" : "Search version, e.g. 1.21.11"} className="w-full bg-transparent py-3 text-sm outline-none" />
        </label>
        <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="rounded-xl border border-dragon-border bg-dragon-dark px-3 py-3 text-sm">
          <option value="release">{ar ? "إصدارات مستقرة" : "Releases"}</option>
          <option value="snapshot">{ar ? "إصدارات تجريبية" : "Snapshots"}</option>
          <option value="all">{ar ? "الكل" : "All types"}</option>
        </select>
      </div>

      {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{ar ? "تعذر الاتصال بكتالوج Mojang:" : "Could not load Mojang catalog:"} {error}</span></div>}
      {loading && <p className="py-8 text-center text-sm text-slate-400">{ar ? "جارٍ جلب الإصدارات من Mojang..." : "Loading versions from Mojang..."}</p>}
      {!loading && !error && (
        <>
          <p className="mt-4 text-xs text-slate-500">{ar ? `تم العثور على ${filtered.length} إصدار` : `${filtered.length} versions found`}</p>
          <div className="mt-2 max-h-[460px] space-y-2 overflow-y-auto pe-1">
            {filtered.slice(0, 120).map(v => {
              const active = selectedVersion === v.id;
              return <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dragon-border bg-dragon-dark/70 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-bold">{v.id}</span><span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{v.type}</span></div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(v.releaseTime).toLocaleDateString(ar ? "ar" : "en")}</p>
                </div>
                <button onClick={() => onSelect(v.id)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${active ? "bg-emerald-500/15 text-emerald-300" : "bg-dragon-accent text-white hover:bg-rose-600"}`}>
                  {active ? <CheckCircle2 size={15} /> : null}{active ? (ar ? "محدد" : "Selected") : (ar ? "اختيار الإصدار" : "Select")}
                </button>
              </div>;
            })}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{ar ? "لا توجد نتائج مطابقة." : "No matching versions."}</p>}
          </div>
        </>
      )}
      <p className="mt-4 border-t border-dragon-border pt-3 text-xs leading-6 text-amber-200/80">{ar ? "ملاحظة: هذه المرحلة تجلب الإصدارات وتتيح تحديدها. التنزيل والتثبيت والتشغيل الحقيقي ستُربط بمحرك Minecraft منفصل قبل تفعيل زر اللعب." : "Note: this phase fetches and selects versions. Download, installation and real launching will be connected to the Minecraft runtime before Play is enabled."}</p>
    </section>
  );
}
