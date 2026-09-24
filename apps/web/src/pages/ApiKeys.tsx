import { Copy, KeyRound, Plus, ShieldOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApiKeyInfo } from "@lain/shared";
import { api, ApiRequestError } from "../api";
import { Header } from "./Dashboard";

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; key: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => { api.apiKeys().then(setKeys).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load API keys")); };
  useEffect(load, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api.createApiKey(name.trim());
      setCreated({ name: result.name, key: result.key });
      setName("");
      load();
    } catch (cause) { setError(cause instanceof ApiRequestError ? cause.message : "Could not create the API key"); }
    finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setError("");
    try { await api.revokeApiKey(id); load(); }
    catch (cause) { setError(cause instanceof ApiRequestError ? cause.message : "Could not revoke the key"); }
  };

  return <>
    <Header eyebrow="ACCESS / API KEYS" title="API keys" />
    <p className="mb-6 max-w-3xl text-sm leading-6 text-white/45">Machine credentials for <span className="font-mono text-white/60">lainctl</span>, scripts, and CI. A key can do everything the dashboard can; distribute it as an environment variable on headless servers (<span className="font-mono text-white/60">LAIN_API_KEY</span>) or store it in the OS keychain with <span className="font-mono text-white/60">lainctl auth login</span>. Rolling a key means creating a replacement and revoking the old one.</p>
    <div className="panel mb-6 overflow-hidden">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 border-b border-white/10 p-4">
        <label className="min-w-64 flex-1"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.16em] text-white/30">New key name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="home-ci, workstation…" maxLength={100} required /></label>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}><Plus size={15}/>Create key</button>
      </form>
      {created && <div className="border-b border-white/10 bg-wired-500/[.06] p-4">
        <div className="mb-2 flex items-center gap-2 text-xs text-wired-300"><KeyRound size={14}/><span className="font-medium">{created.name}</span> — copy it now; it is shown only once and only its hash is stored.</div>
        <div className="flex items-center gap-2"><code className="flex-1 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/80">{created.key}</code><button type="button" className="btn-secondary" onClick={() => { void navigator.clipboard?.writeText(created.key); }}><Copy size={14}/>Copy</button></div>
      </div>}
      <div className="divide-y divide-white/[.07]">
        {keys.map((key) => <div key={key.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1"><div className="font-medium">{key.name}{key.revokedAt && <span className="ml-2 rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-rose-300">revoked</span>}</div><div className="mt-1 font-mono text-xs text-white/35">{key.prefix}… created {new Date(key.createdAt).toLocaleDateString()} · {key.revokedAt ? "—" : key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : "never used"}</div></div>
          {!key.revokedAt && <button type="button" className="btn-secondary text-rose-300 hover:border-rose-400/30 hover:text-rose-200" onClick={() => void revoke(key.id)}><Trash2 size={14}/>Revoke</button>}
        </div>)}
        {keys.length === 0 && <div className="p-12 text-center text-sm text-white/40">No API keys yet.</div>}
      </div>
      {error && <div className="flex items-center gap-2 border-t border-white/10 p-4 text-sm text-rose-300"><ShieldOff size={15}/>{error}</div>}
    </div>
  </>;
}
