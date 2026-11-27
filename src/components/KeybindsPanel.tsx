import { useRef, useState } from "react";
import { Download, FileUp, Plus, Trash2, Keyboard } from "lucide-react";
import type { Language } from "../locales/translations";

type Action = { type: "select_slot" | "press_key" | "attack" | "use_item" | "build" | "wait"; value?: string };
type Binding = { id: string; name: string; key: string; actions: Action[] };
const STORE_KEY = "dragon.keybinds.v1";
const defaults: Binding[] = [
  { id: "slot-two", name: "Hotbar 2", key: "F", actions: [{ type: "select_slot", value: "2" }] },
  { id: "quick-build", name: "Quick build", key: "G", actions: [{ type: "select_slot", value: "2" }, { type: "use_item" }, { type: "wait", value: "100" }] }
];
const actionNames: Record<Action["type"], { ar: string; en: string }> = {
  select_slot: { ar: "اختيار خانة من الهوت بار", en: "Select hotbar slot" },
  press_key: { ar: "ضغط زر", en: "Press key" },
  attack: { ar: "هجوم", en: "Attack" },
  use_item: { ar: "استخدام العنصر", en: "Use item" },
  build: { ar: "بناء", en: "Build" },
  wait: { ar: "انتظار (مللي ثانية)", en: "Wait (milliseconds)" }
};

function loadBindings(): Binding[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (Array.isArray(value)) return value;
  } catch { /* use defaults */ }
  return defaults;
}

export default function KeybindsPanel({ lang }: { lang: Language }) {
  const ar = lang === "ar";
  const [bindings, setBindings] = useState<Binding[]>(loadBindings);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const persist = (next: Binding[]) => { setBindings(next); localStorage.setItem(STORE_KEY, JSON.stringify(next)); setNotice(ar ? "تم حفظ ملف الأزرار على هذا الجهاز." : "Keybind profile saved on this device."); setError(""); };
  const patch = (id: string, changes: Partial<Binding>) => persist(bindings.map(b => b.id === id ? { ...b, ...changes } : b));
  const add = () => persist([...bindings, { id: crypto.randomUUID(), name: ar ? "زر جديد" : "New button", key: "", actions: [{ type: "press_key", value: "E" }] }]);
  const remove = (id: string) => persist(bindings.filter(b => b.id !== id));
  const updateAction = (binding: Binding, index: number, action: Action) => patch(binding.id, { actions: binding.actions.map((a, i) => i === index ? action : a) });
  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ format: "dragon-keybinds", version: 1, bindings }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "dragon-keybinds.json"; anchor.click(); URL.revokeObjectURL(url);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const fileText = await file.text();
      let incoming: any;
      if (file.name.toLowerCase().endsWith(".txt")) {
        incoming = fileText.split(/\r?\n/).flatMap(line => {
          const match = line.match(/^(key_key\.[^:]+):(.+)$/);
          if (!match) return [];
          const id = match[1].replace("key_key.", "");
          return [{ name: id.replaceAll("_", " "), key: match[2].trim().replace("key.keyboard.", "").replace("key.mouse.", "MOUSE_"), actions: [{ type: "press_key", value: match[2].trim() }] }];
        });
      } else {
        const parsed = JSON.parse(fileText);
        incoming = Array.isArray(parsed) ? parsed : (parsed.bindings || parsed.keybinds);
        if (incoming && !Array.isArray(incoming) && typeof incoming === "object") {
          incoming = Object.entries(incoming).map(([name, key]) => ({ name, key: String(key), actions: [{ type: "press_key", value: String(key) }] }));
        }
      }
      if (!Array.isArray(incoming) || incoming.length > 100) throw new Error("Unsupported keybind format");
      const clean = incoming.map((item: any) => {
        if (!item || typeof item.name !== "string" || typeof item.key !== "string" || !Array.isArray(item.actions) || item.actions.length < 1 || item.actions.length > 4) throw new Error("Each button must have 1–4 actions");
        const actions = item.actions.map((a: any) => {
          if (!Object.prototype.hasOwnProperty.call(actionNames, a.type)) throw new Error("Unsupported action type");
          if (a.type === "select_slot" && !/^[1-9]$/.test(String(a.value))) throw new Error("Hotbar slot must be 1–9");
          return { type: a.type, ...(a.value !== undefined ? { value: String(a.value).slice(0, 100) } : {}) };
        });
        return { id: crypto.randomUUID(), name: item.name.slice(0, 40), key: item.key.slice(0, 20), actions };
      });
      persist(clean);
    } catch (e) { setError((ar ? "تعذر استيراد الملف: " : "Import failed: ") + String(e)); }
  };

  return <section className="feature-page">
    <div className="feature-intro"><div className="feature-symbol"><Keyboard size={25} /></div><div><h3>{ar ? "محرر الأزرار والاختصارات" : "Keybind & macro editor"}</h3><p>{ar ? "أنشئ أزرارك وسمّها ورتّب حتى 4 وظائف متسلسلة لكل زر." : "Create named buttons and configure up to 4 ordered actions per button."}</p></div></div>
    <div className="feature-callout"><Keyboard size={18}/><span>{ar ? "يمكن استيراد وتصدير ملف DRAGON JSON. يمكن استيراد JSON أو خيارات Minecraft options.txt من مجلد اللعبة. ملفات الماكرو الخاصة بمودات خارجية تحتاج محولاً خاصاً بصيغتها. حفظ الاختصارات يعمل الآن؛ تنفيذها داخل Minecraft يحتاج ربط محرك الإدخال الذي لم يكتمل بعد." : "DRAGON JSON import/export is supported. Minecraft options.txt and DRAGON JSON can be imported. Third-party macro formats need dedicated adapters. Profiles save now; in-game execution requires the input bridge, which is not implemented yet."}</span></div>
    <div className="settings-actions">
      <button onClick={add}><Plus size={16}/>{ar ? "إضافة زر" : "Add button"}</button>
      <button onClick={() => fileRef.current?.click()}><FileUp size={16}/>{ar ? "استيراد ملف أزرار" : "Import keybind file"}</button>
      <button onClick={exportFile}><Download size={16}/>{ar ? "تصدير ملف الأزرار" : "Export profile"}</button>
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={e => { void importFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
    </div>
    {notice && <p className="settings-message">{notice}</p>}{error && <p className="feature-error">{error}</p>}
    {bindings.map(binding => <article className="settings-group" key={binding.id}>
      <div className="settings-label"><strong>{binding.name}</strong><button className="account-remove" onClick={() => remove(binding.id)} aria-label="Delete"><Trash2 size={15}/></button></div>
      <div className="settings-two">
        <label>{ar ? "اسم الزر" : "Button name"}<input className="feature-input" value={binding.name} maxLength={40} onChange={e => patch(binding.id, { name: e.target.value })}/></label>
        <label>{ar ? "مفتاح الاختصار" : "Shortcut key"}<input className="feature-input" value={binding.key} maxLength={20} placeholder="F" onChange={e => patch(binding.id, { key: e.target.value.toUpperCase() })}/></label>
      </div>
      <p className="feature-footnote">{ar ? "الوظائف (بالترتيب)" : "Actions (in order)"} · {binding.actions.length}/4</p>
      {binding.actions.map((action, index) => <div className="settings-two macro-action" key={index}>
        <label><span>{index + 1}. {ar ? "الوظيفة" : "Action"}</span><select className="feature-input" value={action.type} onChange={e => updateAction(binding, index, { type: e.target.value as Action["type"] })}>{Object.entries(actionNames).map(([type, label]) => <option key={type} value={type}>{ar ? label.ar : label.en}</option>)}</select></label>
        {(action.type === "select_slot" || action.type === "press_key" || action.type === "wait") && <label>{action.type === "select_slot" ? (ar ? "الخانة 1–9" : "Slot 1–9") : action.type === "wait" ? (ar ? "المدة" : "Duration") : (ar ? "المفتاح" : "Key")}<input className="feature-input" value={action.value || ""} onChange={e => updateAction(binding, index, { ...action, value: e.target.value })} /></label>}
        <button className="account-remove" onClick={() => patch(binding.id, { actions: binding.actions.filter((_, i) => i !== index) })} aria-label="Remove action"><Trash2 size={14}/></button>
      </div>)}
      <button className="account-select" disabled={binding.actions.length >= 4} onClick={() => patch(binding.id, { actions: [...binding.actions, { type: "press_key", value: "E" }] })}><Plus size={14}/> {ar ? "إضافة وظيفة" : "Add action"}</button>
    </article>)}
    {bindings.length === 0 && <div className="feature-empty">{ar ? "لا توجد أزرار بعد. أضف زرّك الأول." : "No buttons yet. Add your first one."}</div>}
  </section>;
}
