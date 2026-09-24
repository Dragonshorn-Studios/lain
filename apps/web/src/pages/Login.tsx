import { LockKeyhole, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiRequestError } from "../api";

export function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = searchParams.get("next") ?? "/";

  useEffect(() => { api.authSession().then((session) => setMode(session.setupRequired ? "setup" : "login")).catch(() => setMode("login")); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "setup" && password !== confirm) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try {
      await (mode === "setup" ? api.authSetup(password) : api.authLogin(password));
      navigate(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Could not reach laind");
    } finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-md pt-10">
    <div className="panel p-8">
      <div className="mb-6 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg border border-wired-500/30 bg-wired-500/10 text-wired-400"><LockKeyhole size={18}/></div><div><h1 className="text-xl font-semibold">{mode === "setup" ? "Set your admin password" : "Sign in to Lain"}</h1><p className="mt-1 text-xs text-white/35">{mode === "setup" ? "First-run setup for this Lain node" : "Single-admin dashboard access"}</p></div></div>
      {mode === "setup" && <div className="mb-6 flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-5 text-amber-200/80"><ShieldAlert size={15} className="mt-0.5 shrink-0"/><span>Whoever completes this step first owns the dashboard. Do it immediately after installation, while the host is still under your control.</span></div>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.16em] text-white/30">Admin password</span><input type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete={mode === "setup" ? "new-password" : "current-password"} minLength={mode === "setup" ? 10 : undefined} required /></label>
        {mode === "setup" && <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.16em] text-white/30">Confirm password</span><input type="password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></label>}
        {mode === "setup" && <p className="text-xs leading-5 text-white/35">At least 10 characters. Only a scrypt hash is stored — the password itself never leaves this form. Machines (lainctl, CI) authenticate with API keys instead, managed under <span className="font-mono text-white/50">/api-keys</span>.</p>}
        {error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">{error}</div>}
        <button type="submit" className="btn-primary w-full justify-center" disabled={busy || !password}>{busy ? "Working…" : mode === "setup" ? "Configure and sign in" : "Sign in"}</button>
      </form>
    </div>
  </div>;
}
