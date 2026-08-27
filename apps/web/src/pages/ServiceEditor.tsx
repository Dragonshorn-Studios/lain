import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ServiceInput, ServiceWithStatus } from "@lain/shared";
import { api } from "../api";
import { ServiceForm } from "../components/ServiceForm";

export function ServiceEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [service, setService] = useState<ServiceWithStatus>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (id) void api.service(id).then(setService).catch((e) => setError(e.message)); }, [id]);
  const save = async (input: ServiceInput) => {
    setSubmitting(true); setError("");
    try { const saved = id ? await api.update(id, input) : await api.create(input); navigate(`/services/${saved.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save service"); setSubmitting(false); }
  };
  const initial = service ? (({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, status: _status, ...input }) => input)(service) : undefined;
  if (id && !service && !error) return <div className="text-sm text-white/40">Loading service…</div>;
  return <>
    <Link className="mb-5 inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70" to={id ? `/services/${id}` : "/services"}><ArrowLeft size={15}/>Back</Link>
    <header className="mb-8"><div className="mb-3 font-mono text-[10px] uppercase tracking-[.24em] text-wired-400/70">REGISTRY / {id ? "EDIT" : "NEW"}</div><h1 className="text-3xl font-semibold tracking-tight">{id ? "Edit service" : "Add a service"}</h1><p className="mt-2 text-sm text-white/40">Declare the service once. Lain derives the network configuration.</p></header>
    {error && <div className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-300">{error}</div>}
    {(!id || initial) && <ServiceForm initial={initial} onSubmit={save} submitting={submitting}/>} 
  </>;
}
