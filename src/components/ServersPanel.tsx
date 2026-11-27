import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Plus, RefreshCw, Trash2, Star, Server, Wifi, WifiOff } from "lucide-react";
import type { Language } from "../locales/translations";

type ServerEntry = { id: string; name: string; host: string; port: number; favorite: boolean };
type PingResult = { online: boolean; host: string; port: number; latency_ms: number | null; players_online: number | null; players_max: number | null; version: string | null; motd: string | null; favicon: string | null; error: string | null };
const STORAGE_KEY = "dragon.minecraftServers";

export default function ServersPanel({ lang }: { lang: Language }) {
  const ar = lang === "ar";
  const native = isTauri();
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [results, setResults] = useState<Record<string, PingResult>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("25565");
  const [error, setError] = useState("");

  useEffect(() => {
    try { setServers(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); } catch { setServers([]); }
  }, []);
  const persist = (next: ServerEntry[]) => { setServers(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); };
  const ping = useCallback(async (entry: ServerEntry) => {
    if (!native) { setError(ar ? "فحص السيرفرات يحتاج تشغيل التطبيق المثبت." : "Server checks require the installed app."); return; }
    setBusy(old => ({ ...old, [entry.id]: true }));
    try {
      const result = await invoke<PingResult>("ping_minecraft_server", { host: entry.host, port: entry.port });
      setResults(old => ({ ...old, [entry.id]: result }));
    } catch (e) {
      setResults(old => ({ ...old, [entry.id]: { online: false, host: entry.host, port: entry.port, latency_ms: null, players_online: null, players_max: null, version: null, motd: null, favicon: null, error: String(e) } }));
    } finally { setBusy(old => ({ ...old, [entry.id]: false })); }
  }, [native, ar]);

  const add = () => {
    setError("");
    const cleanHost = host.trim();
    const numericPort = Number(port);
    if (!cleanHost || cleanHost.length > 253 || !/^[a-zA-Z0-9.:-]+$/.test(cleanHost)) { setError(ar ? "اكتب عنوان سيرفر صحيحاً." : "Enter a valid server address."); return; }
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) { setError(ar ? "المنفذ يجب أن يكون بين 1 و65535." : "Port must be between 1 and 65535."); return; }
    if (servers.some(s => s.host.toLowerCase() === cleanHost.toLowerCase() && s.port === numericPort)) { setError(ar ? "هذا السيرفر مضاف مسبقاً." : "This server is already added."); return; }
    const entry = { id: crypto.randomUUID(), name: name.trim() || cleanHost, host: cleanHost, port: numericPort, favorite: false };
    persist([...servers, entry]); setName(""); setHost(""); setPort("25565");
    void ping(entry);
  };
  const remove = (id: string) => { persist(servers.filter(s => s.id !== id)); setResults(old => { const next = { ...old }; delete next[id]; return next; }); };
  const update = (entry: ServerEntry) => persist(servers.map(s => s.id === entry.id ? entry : s));
  const panelStyle: React.CSSProperties = { background: "var(--panel, rgba(20,24,34,.72))", border: "1px solid var(--border, rgba(255,255,255,.1))", borderRadius: 16, padding: 18 };
  const inputStyle: React.CSSProperties = { minWidth: 0, width: "100%", padding: "11px 12px", borderRadius: 9, border: "1px solid var(--border, rgba(255,255,255,.16))", background: "rgba(0,0,0,.18)", color: "inherit" };
  return <div style={{ display: "grid", gap: 16 }}>
    <section style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>{ar ? "إضافة سيرفر Minecraft Java" : "Add a Minecraft Java server"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={ar ? "اسم السيرفر (اختياري)" : "Server name (optional)"} />
        <input style={inputStyle} value={host} onChange={e => setHost(e.target.value)} placeholder="play.example.net" />
        <input style={inputStyle} value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" placeholder="25565" />
        <button className="browse-button" onClick={add}><Plus size={17} />{ar ? "إضافة" : "Add server"}</button>
      </div>
      {error && <p role="alert" style={{ color: "#ff8585" }}>{error}</p>}
      <p style={{ opacity: .65, fontSize: 12, marginBottom: 0 }}>{ar ? "يعرض هذا الفحص معلومات Minecraft Multiplayer العامة. قد يخفي بعض السيرفرات عدد اللاعبين أو الإصدار." : "Reads public Minecraft Multiplayer status. Some servers hide player counts or version details."}</p>
    </section>
    {servers.length === 0 ? <section style={{ ...panelStyle, textAlign: "center", opacity: .8 }}><Server size={30} /><p>{ar ? "ما أضفت أي سيرفر بعد." : "No servers added yet."}</p></section> :
      servers.slice().sort((a,b) => Number(b.favorite)-Number(a.favorite)).map(entry => {
        const result = results[entry.id];
        return <article key={entry.id} style={{ ...panelStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {result?.favicon?.startsWith("data:image/") ? <img src={result.favicon} alt="" width="48" height="48" style={{ borderRadius: 8 }} /> : <span style={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 8, background: "rgba(255,255,255,.07)" }}><Server /></span>}
            <div style={{ flex: 1, minWidth: 0 }}><strong>{entry.name}</strong><div style={{ opacity: .65, fontSize: 12, overflowWrap: "anywhere" }}>{entry.host}:{entry.port}</div></div>
            <span title={result?.online ? "Online" : "Offline"}>{result ? result.online ? <Wifi color="#4bd18b" /> : <WifiOff color="#ff7777" /> : <span style={{ opacity: .6 }}>—</span>}</span>
          </div>
          {result && <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 13 }}>
            <span>{result.online ? (ar ? "متصل" : "Online") : (ar ? "غير متصل" : "Offline")}</span>
            {result.players_online !== null && result.players_max !== null && <span>👥 {result.players_online}/{result.players_max}</span>}
            {result.latency_ms !== null && <span>◷ {result.latency_ms} ms</span>}
            {result.version && <span>{result.version}</span>}
          </div>}
          {result?.motd && <div style={{ opacity: .75, fontSize: 13, overflowWrap: "anywhere" }}>{result.motd}</div>}
          {result?.error && <div style={{ color: "#ff9999", fontSize: 12 }}>{result.error}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="browse-button" onClick={() => void ping(entry)} disabled={!!busy[entry.id]}><RefreshCw size={15} />{busy[entry.id] ? (ar ? "يفحص..." : "Checking...") : (ar ? "فحص الآن" : "Refresh")}</button>
            <button className="browse-button" onClick={() => update({ ...entry, favorite: !entry.favorite })}><Star size={15} fill={entry.favorite ? "currentColor" : "none"} />{entry.favorite ? (ar ? "إزالة المفضلة" : "Unfavorite") : (ar ? "مفضلة" : "Favorite")}</button>
            <button className="browse-button" onClick={() => remove(entry.id)}><Trash2 size={15} />{ar ? "حذف" : "Remove"}</button>
          </div>
        </article>;
      })}
  </div>;
}
