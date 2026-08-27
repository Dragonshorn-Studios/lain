import { ArrowLeft, ExternalLink, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ServiceWithStatus } from "@lain/shared";
import { api } from "../api";
import { HealthBadge, StatusDot } from "../components/Status";

export function ServiceDetail() {
  const { id = "" } = useParams(); const navigate = useNavigate();
  const [service, setService] = useState<ServiceWithStatus>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = async () => { try { setService(await api.service(id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not load service"); } };
  useEffect(() => { void load(); }, [id]);
  const reconcile = async () => { setBusy(true); try { await api.reconcile(id); await load(); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm("Delete this service from the registry?")) return; await api.remove(id); navigate("/services"); };
  if (error) return <div className="text-rose-300">{error}</div>;
  if (!service) return <div className="text-sm text-white/40">Loading service…</div>;
  const allComponents = ["dns", "proxy", "tls", "cloudflare-dns", "cloudflare-tunnel"] as const;
  return <>
    <Link className="mb-5 inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70" to="/services"><ArrowLeft size={15}/>All services</Link>
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5"><div><div className="mb-3 flex items-center gap-3"><HealthBadge healthy={service.status.healthy}/><span className="font-mono text-[10px] uppercase tracking-[.18em] text-white/30">{service.site} / {service.exposure}</span></div><h1 className="text-3xl font-semibold tracking-tight">{service.name}</h1><a className="mt-2 inline-flex items-center gap-2 font-mono text-sm text-wired-400/70 hover:text-wired-400" href={`${service.tlsEnabled ? "https" : "http"}://${service.hostname}`} target="_blank">{service.hostname}<ExternalLink size={13}/></a></div>
      <div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={() => void reconcile()}><RefreshCw size={15} className={busy ? "animate-spin" : ""}/>Reconcile</button><Link className="btn-secondary" to={`/services/${id}/edit`}><Pencil size={15}/>Edit</Link></div>
    </header>
    <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <section className="panel p-6"><h2 className="font-medium">Service declaration</h2><dl className="mt-6 space-y-5"><Item label="Upstream" value={`${service.targetProtocol}://${service.targetHost}:${service.targetPort}`}/><Item label="Exposure" value={service.exposure}/><Item label="Site" value={service.site}/><Item label="Health" value={service.status.healthMessage}/><Item label="Last check" value={service.status.checkedAt ? new Date(service.status.checkedAt).toLocaleString() : "Not checked"}/></dl></section>
      <section className="panel overflow-hidden"><div className="border-b border-white/10 p-6"><h2 className="font-medium">Desired vs actual</h2><p className="mt-1 text-sm text-white/40">Each component is derived from the service declaration.</p></div><div className="divide-y divide-white/[.07]">{allComponents.map((name) => {
        const status = service.status.components.find((item) => item.component === name);
        return <div className="grid gap-3 px-6 py-4 sm:grid-cols-[150px_1fr_1fr]" key={name}><div className="flex items-center gap-2 text-sm font-medium"><StatusDot state={status?.state ?? "pending"}/>{name}</div><div><div className="label">Desired</div><div className="font-mono text-xs text-white/60">{status?.desired ?? "Awaiting reconciliation"}</div></div><div><div className="label">Actual</div><div className="font-mono text-xs text-white/60">{status?.actual ?? "Unknown"}</div>{status?.message && <div className="mt-1 text-xs text-white/30">{status.message}</div>}</div></div>;
      })}</div></section>
    </div>
    <div className="mt-8 border-t border-white/10 pt-6"><button className="inline-flex items-center gap-2 text-sm text-rose-400/60 hover:text-rose-400" onClick={() => void remove()}><Trash2 size={15}/>Delete service</button></div>
  </>;
}
function Item({ label, value }: { label: string; value: string }) { return <div><dt className="label">{label}</dt><dd className="break-all font-mono text-sm text-white/70">{value}</dd></div>; }
