import { Activity, AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronDown, ChevronUp, Cloud, Copy, Globe2, Plus, RefreshCw, Server, Terminal, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardSummary, ServiceWithStatus } from "@lain/shared";
import { api } from "../api";
import { HealthBadge } from "../components/Status";

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [services, setServices] = useState<ServiceWithStatus[]>([]);
  const [error, setError] = useState("");
  const [openFix, setOpenFix] = useState<string>();
  const load = async () => { try { const [nextSummary, nextServices] = await Promise.all([api.dashboard(), api.services()]); setSummary(nextSummary); setServices(nextServices); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not reach laind"); } };
  useEffect(() => { void load(); }, []);
  return <>
    <PresentTimeHeader action={<Link to="/services/new" className="btn-primary"><Plus size={16}/>Add service</Link>} />
    {error && <div className="mb-6 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-300">{error}. Start laind and try again.</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<Boxes/>} label="Managed services" value={summary?.total} />
      <Metric icon={<Activity/>} label="Healthy" value={summary?.healthy} tone="green" />
      <Metric icon={<Server/>} label="Needs attention" value={summary?.unhealthy} tone="red" />
      <Metric icon={<Globe2/>} label="Public" value={summary?.publicServices} />
    </div>
    {summary?.setup && <section className="panel mt-6 overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Host setup</h2><p className="mt-1 text-xs text-white/35">OS dependencies and daemon status on this Lain node</p></div><div className="font-mono text-[10px] uppercase tracking-wider text-white/30">{summary.setup.platform} {summary.setup.release} · {summary.setup.architecture}</div></div>
      </div>
      <div className="grid divide-y divide-white/[.07] md:grid-cols-2 md:divide-y-0">
        {summary.setup.checks.map((item) => <SetupRow key={item.id} item={item} open={openFix === item.id} onToggle={() => setOpenFix(openFix === item.id ? undefined : item.id)}/>)}
      </div>
      <div className="flex gap-2 border-t border-white/[.07] bg-black/10 px-5 py-3 text-xs leading-5 text-white/35"><Terminal size={15} className="mt-0.5 shrink-0"/><span>Fixes run only after local terminal approval. The dashboard cannot execute privileged commands or receive secrets.</span></div>
    </section>}
    <section className="panel mt-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><h2 className="font-medium">Recent services</h2><p className="mt-1 text-xs text-white/35">Desired and observed state from the registry</p></div><button className="btn-secondary !px-3 !py-2" onClick={() => void load()}><RefreshCw size={14}/><span className="hidden sm:inline">Refresh</span></button></div>
      {services.length === 0 ? <EmptyState/> : <div className="divide-y divide-white/[.07]">{services.slice(0, 6).map((service) => <Link key={service.id} to={`/services/${service.id}`} className="grid items-center gap-3 px-5 py-4 transition hover:bg-white/[.025] sm:grid-cols-[1fr_1fr_auto_auto]">
        <div><div className="font-medium">{service.name}</div><div className="mt-1 font-mono text-xs text-white/35">{service.hostname}</div></div>
        <div className="hidden font-mono text-xs text-white/45 sm:block">{service.targetProtocol}://{service.targetHost}:{service.targetPort}</div>
        <HealthBadge healthy={service.status.healthy}/><ArrowRight size={15} className="text-white/25"/>
      </Link>)}</div>}
    </section>
    <div className="mt-6 grid gap-4 md:grid-cols-3"><Feature icon={<Server/>} title="Local DNS" detail="Managed internal records with upstream forwarding."/><Feature icon={<Cloud/>} title="Cloudflare" detail="DNS, Tunnel and DNS-01 adapters share service intent."/><Feature icon={<RefreshCw/>} title="Reconciliation" detail="Drift is visible and corrected on a steady loop."/></div>
  </>;
}

export function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) { return <header className="mb-8 flex items-end justify-between gap-4"><div><div className="mb-3 font-mono text-[10px] uppercase tracking-[.24em] text-wired-400/70">{eyebrow}</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1></div>{action}</header>; }
function PresentTimeHeader({ action }: { action: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1_000); return () => window.clearInterval(timer); }, []);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
  return <header className="present-hero mb-8 overflow-hidden rounded-2xl border border-wired-400/20">
    <img src="/wired-signal-hero.png" alt="" aria-hidden="true" className="generated-hero-image"/>
    <div className="present-hero-noise" aria-hidden="true"/>
    <div className="relative z-10 flex min-h-[230px] flex-col justify-between gap-8 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4"><div className="font-mono text-[10px] uppercase tracking-[.28em] text-wired-400/70">Protocol 7 // The Wired</div>{action}</div>
      <div><h1 className="present-title" data-text="PRESENT DAY. PRESENT TIME."><span>PRESENT DAY.</span><span>PRESENT TIME.</span></h1><div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[.18em] text-emerald-50/50"><span>{day}</span><span className="text-wired-400">{time}</span><span>NODE: HOME</span></div></div>
    </div>
  </header>;
}
function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value?: number; tone?: "green" | "red" }) { return <div className="panel p-5"><div className={`mb-5 w-fit ${tone === "green" ? "text-emerald-400" : tone === "red" ? "text-rose-400" : "text-white/35"}`}>{icon}</div><div className="font-mono text-3xl font-medium">{value ?? "—"}</div><div className="mt-2 text-xs text-white/40">{label}</div></div>; }
function SetupIcon({ state }: { state: "ready" | "warning" | "error" }) { const Icon = state === "ready" ? CheckCircle2 : state === "warning" ? AlertTriangle : XCircle; return <Icon size={18} className={`mt-0.5 shrink-0 ${state === "ready" ? "text-emerald-400" : state === "warning" ? "text-amber-300" : "text-rose-400"}`}/>; }
function SetupRow({ item, open, onToggle }: { item: NonNullable<DashboardSummary["setup"]>["checks"][number]; open: boolean; onToggle: () => void }) {
  const copy = () => item.remediation && void navigator.clipboard?.writeText(item.remediation.command);
  return <div className="border-white/[.07] px-5 py-4 md:border-b md:odd:border-r">
    <div className="flex gap-3"><SetupIcon state={item.state}/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-medium">{item.label}{item.required && <span className="rounded bg-white/[.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/35">required</span>}</div><div className="mt-1 break-words font-mono text-xs leading-5 text-white/40">{item.detail}</div></div>{item.remediation && <button type="button" className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={onToggle}>Fix {open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</button>}</div></div></div>
    {open && item.remediation && <div className="ml-7 mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[.035] p-3"><p className="text-xs leading-5 text-white/50">{item.remediation.description}</p><div className="mt-2 flex items-start gap-2"><code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre rounded bg-black/35 px-3 py-2 font-mono text-[11px] leading-5 text-amber-100/75">{item.remediation.command}</code><button type="button" title="Copy command" aria-label="Copy command" className="btn-secondary !p-2" onClick={copy}><Copy size={14}/></button></div><p className="mt-2 text-[10px] leading-4 text-white/30">Run locally on the Lain host. Review the plan before confirming; token values must be supplied through files.</p></div>}
  </div>;
}
function Feature({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="rounded-xl border border-white/[.07] p-4"><div className="mb-3 text-wired-400/60">{icon}</div><div className="text-sm font-medium">{title}</div><div className="mt-1 text-xs leading-5 text-white/35">{detail}</div></div>; }
function EmptyState() { return <div className="py-14 text-center"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-white/5 text-white/30"><Boxes/></div><div className="font-medium">No services in the Wired yet</div><p className="mt-2 text-sm text-white/35">Add the first service to create desired network state.</p><Link className="btn-primary mt-5" to="/services/new"><Plus size={16}/>Add service</Link></div>; }
