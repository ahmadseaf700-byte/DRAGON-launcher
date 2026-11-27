import { useState } from "react";
import { Blocks, Package } from "lucide-react";
import type { Language } from "../locales/translations";
import ModrinthCatalog from "./ModrinthCatalog";

export default function LibraryCatalog({ lang, selectedInstanceId }: { lang: Language; selectedInstanceId: string | null }) {
  const [kind, setKind] = useState<"mod" | "modpack">("mod");
  const ar = lang === "ar";
  return <div className="library-page">
    <div className="settings-actions library-switch" role="tablist" aria-label={ar ? "نوع المحتوى" : "Library content"}>
      <button role="tab" aria-selected={kind === "mod"} className={kind === "mod" ? "active" : ""} onClick={() => setKind("mod")}><Blocks size={16}/>{ar ? "المودات" : "Mods"}</button>
      <button role="tab" aria-selected={kind === "modpack"} className={kind === "modpack" ? "active" : ""} onClick={() => setKind("modpack")}><Package size={16}/>{ar ? "حزم المودات" : "Modpacks"}</button>
    </div>
    <ModrinthCatalog key={kind} lang={lang} kind={kind} instanceId={selectedInstanceId} />
  </div>;
}
