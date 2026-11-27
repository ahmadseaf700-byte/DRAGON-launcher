import { useEffect, useState } from "react";
import { UserRoundPlus, UserRound, Check, Trash2, ShieldAlert } from "lucide-react";
import type { Language } from "../locales/translations";

type LocalAccount = { id: string; username: string; uuid: string; createdAt: number };

export default function AccountsPanel({ lang }: { lang: Language }) {
  const ar = lang === "ar";
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [username, setUsername] = useState("");
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dragon.localAccounts") || "[]") as LocalAccount[];
      setAccounts(Array.isArray(saved) ? saved : []);
      setActiveId(localStorage.getItem("dragon.activeAccount") || "");
    } catch { setAccounts([]); }
  }, []);

  const persist = (next: LocalAccount[], active = activeId) => {
    setAccounts(next);
    setActiveId(active);
    localStorage.setItem("dragon.localAccounts", JSON.stringify(next));
    localStorage.setItem("dragon.activeAccount", active);
  };

  const createAccount = () => {
    const name = username.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setError(ar ? "الاسم يجب أن يتكون من 3 إلى 16 حرفاً أو رقماً أو _." : "Use 3–16 letters, numbers or underscores.");
      return;
    }
    if (accounts.some(a => a.username.toLowerCase() === name.toLowerCase())) {
      setError(ar ? "هذا الاسم موجود بالفعل." : "That username already exists.");
      return;
    }
    const account = { id: crypto.randomUUID(), username: name, uuid: crypto.randomUUID(), createdAt: Date.now() };
    persist([...accounts, account], account.id);
    setUsername("");
    setError("");
  };

  const removeAccount = (id: string) => {
    const next = accounts.filter(a => a.id !== id);
    persist(next, activeId === id ? (next[0]?.id || "") : activeId);
  };

  const active = accounts.find(a => a.id === activeId);
  return <section className="feature-page">
    <div className="feature-intro"><div className="feature-symbol"><UserRound size={25} /></div><div><h3>{ar ? "حسابات اللعب المحلية" : "Local game profiles"}</h3><p>{ar ? "أنشئ ملفات شخصية محلية وبدّل بينها. تُحفظ على هذا الجهاز." : "Create local profiles and switch between them. Stored on this device."}</p></div></div>
    <div className="feature-callout"><ShieldAlert size={18} /><span>{ar ? "الحساب المحلي مخصص للعب دون اتصال أو على خوادم تسمح بوضع Offline فقط. لا يمنح ملكية Minecraft ولا يسجّل دخول Microsoft." : "Local profiles are for offline play or servers that explicitly allow offline mode. They do not prove game ownership or sign in to Microsoft."}</span></div>
    <div className="feature-form"><label htmlFor="offline-name">{ar ? "اسم اللاعب" : "Player name"}</label><div className="feature-form-row"><input id="offline-name" value={username} maxLength={16} onChange={e => setUsername(e.target.value)} placeholder="DragonPlayer" onKeyDown={e => e.key === "Enter" && createAccount()} /><button onClick={createAccount}><UserRoundPlus size={17} />{ar ? "إنشاء حساب" : "Create profile"}</button></div>{error && <p className="feature-error">{error}</p>}</div>
    <div className="feature-list-heading"><strong>{ar ? "الملفات المحفوظة" : "Saved profiles"}</strong><span>{accounts.length}</span></div>
    {accounts.length === 0 ? <div className="feature-empty">{ar ? "لا توجد حسابات محلية بعد. أنشئ أول ملف شخصي أعلاه." : "No local profiles yet. Create your first one above."}</div> : <div className="account-list">{accounts.map(account => <article className={`account-row ${activeId === account.id ? "account-active" : ""}`} key={account.id}><div className="account-avatar">{account.username.slice(0,1).toUpperCase()}</div><div className="account-meta"><strong>{account.username}</strong><small>UUID: {account.uuid}</small></div>{activeId === account.id ? <span className="account-current"><Check size={14} />{ar ? "نشط" : "Active"}</span> : <button className="account-select" onClick={() => persist(accounts, account.id)}>{ar ? "تفعيل" : "Activate"}</button>}<button className="account-remove" aria-label={ar ? "حذف الحساب" : "Delete profile"} onClick={() => removeAccount(account.id)}><Trash2 size={16} /></button></article>)}</div>}
    {active && <p className="feature-footnote">{ar ? "الحساب النشط حالياً:" : "Currently active:"} <strong>{active.username}</strong></p>}
  </section>;
}
