import { ArrowRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ServiceWithStatus } from "@lain/shared";
import { api } from "../api";
import { HealthBadge } from "../components/Status";
import { Header } from "./Dashboard";

export function Services() {
  const [services, setServices] = useState<ServiceWithStatus[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => { void api.services().then(setServices); }, []);
  const visible = useMemo(() => services.filter((service) => `${service.name} ${service.hostname} ${service.site}`.toLowerCase().includes(query.toLowerCase())), [services, query]);
  return <>
    <Header eyebrow="REGISTRY / SERVICES" title="Services" action={<Link to="/services/new" className="btn-primary"><Plus size={16}/>Add service</Link>}/>
    <div className="panel overflow-hidden">
      <div className="border-b border-white/10 p-4"><label className="relative block max-w-sm"><Search size={15} className="absolute left-3 top-3 text-white/30"/><input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services…" /></label></div>
      <div className="hidden grid-cols-[1.2fr_1fr_.65fr_.55fr_auto] gap-4 border-b border-white/10 bg-black/15 px-5 py-3 text-[10px] uppercase tracking-[.16em] text-white/30 md:grid"><span>Service</span><span>Target</span><span>Site</span><span>Status</span><span/></div>
      <div className="divide-y divide-white/[.07]">{visible.map((service) => <Link key={service.id} to={`/services/${service.id}`} className="grid items-center gap-3 px-5 py-4 transition hover:bg-white/[.025] md:grid-cols-[1.2fr_1fr_.65fr_.55fr_auto] md:gap-4">
        <div><div className="font-medium">{service.name}</div><div className="mt-1 font-mono text-xs text-white/35">{service.hostname}</div></div>
        <div className="truncate font-mono text-xs text-white/45">{service.targetHost}:{service.targetPort}</div>
        <div className="text-sm text-white/50">{service.site}</div><HealthBadge healthy={service.status.healthy}/><ArrowRight size={15} className="text-white/25"/>
      </Link>)}</div>
      {visible.length === 0 && <div className="p-12 text-center text-sm text-white/40">No matching services.</div>}
    </div>
  </>;
}
