import { defaultServiceInput, type ServiceInput } from "@lain/shared";
import { useState } from "react";

export function ServiceForm({ initial = defaultServiceInput, onSubmit, submitting }: { initial?: ServiceInput; onSubmit: (value: ServiceInput) => Promise<void>; submitting: boolean }) {
  const [value, setValue] = useState<ServiceInput>(initial);
  const set = <K extends keyof ServiceInput>(key: K, next: ServiceInput[K]) => setValue((current) => ({ ...current, [key]: next }));
  return <form className="panel overflow-hidden" onSubmit={(event) => { event.preventDefault(); void onSubmit(value); }}>
    <section className="grid gap-5 border-b border-white/10 p-6 sm:grid-cols-2">
      <div className="sm:col-span-2"><h2 className="font-medium">Identity</h2><p className="mt-1 text-sm text-white/40">The stable identity clients use to reach this service.</p></div>
      <Field label="Name"><input className="field" required value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Home Assistant" /></Field>
      <Field label="Hostname"><input className="field font-mono" required value={value.hostname} onChange={(e) => set("hostname", e.target.value)} placeholder="home.example.internal" /></Field>
      <Field label="Site"><input className="field" required value={value.site} onChange={(e) => set("site", e.target.value)} placeholder="home" /></Field>
      <Field label="Exposure"><select className="field" value={value.exposure} onChange={(e) => set("exposure", e.target.value as ServiceInput["exposure"])}><option value="internal">Internal</option><option value="private">Private</option><option value="public">Public</option></select></Field>
    </section>
    <section className="grid gap-5 border-b border-white/10 p-6 sm:grid-cols-[140px_1fr_140px]">
      <div className="sm:col-span-3"><h2 className="font-medium">Upstream target</h2><p className="mt-1 text-sm text-white/40">Where Lain forwards traffic and performs health checks.</p></div>
      <Field label="Protocol"><select className="field" value={value.targetProtocol} onChange={(e) => set("targetProtocol", e.target.value as ServiceInput["targetProtocol"])}><option value="http">HTTP</option><option value="https">HTTPS</option></select></Field>
      <Field label="Host"><input className="field font-mono" required value={value.targetHost} onChange={(e) => set("targetHost", e.target.value)} placeholder="192.168.1.20" /></Field>
      <Field label="Port"><input className="field font-mono" type="number" min="1" max="65535" required value={value.targetPort} onChange={(e) => set("targetPort", Number(e.target.value))} /></Field>
    </section>
    <section className="p-6"><div><h2 className="font-medium">Derived state</h2><p className="mt-1 text-sm text-white/40">Lain continuously reconciles enabled components from this service declaration.</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Toggle label="Managed DNS" detail="Create the appropriate local or Cloudflare record." checked={value.dnsEnabled} onChange={(v) => set("dnsEnabled", v)} />
        <Toggle label="Reverse proxy" detail="Route HTTP and WebSocket traffic by hostname." checked={value.proxyEnabled} onChange={(v) => set("proxyEnabled", v)} />
        <Toggle label="TLS certificate" detail="Provision with Let's Encrypt DNS-01." checked={value.tlsEnabled} onChange={(v) => { set("tlsEnabled", v); set("tlsProvider", v ? "letsencrypt-cloudflare" : "none"); }} />
        <Toggle label="Cloudflare Tunnel" detail="Publish through the externally managed cloudflared daemon." checked={value.cloudflareTunnelEnabled} disabled={value.exposure !== "public"} onChange={(v) => set("cloudflareTunnelEnabled", v)} />
      </div>
    </section>
    <footer className="flex justify-end border-t border-white/10 bg-black/15 px-6 py-4"><button className="btn-primary" disabled={submitting}>{submitting ? "Saving…" : "Save service"}</button></footer>
  </form>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Toggle({ label, detail, checked, disabled, onChange }: { label: string; detail: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/15 p-4 ${disabled ? "opacity-40" : "hover:border-white/20"}`}><input className="mt-1 accent-[#42d99c]" type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-5 text-white/40">{detail}</span></span></label>;
}
