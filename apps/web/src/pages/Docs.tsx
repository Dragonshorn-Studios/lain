import { AlertTriangle, ArrowRight, Box, Check, CheckCircle2, Cloud, Code2, Copy, Laptop, LockKeyhole, Monitor, Network, Router, Server, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import type { ServiceWithStatus, SystemSetup } from "@lain/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

const navigation = [
  ["start", "Quick start"], ["model", "How it works"], ["services", "Service model"],
  ["host-setup", "Host setup"], ["proxmox", "Proxmox LXC"], ["client-dns", "Client DNS"], ["configuration", "Configuration"], ["operations", "Operations"], ["security", "Security"]
] as const;

const environment = [
  ["LAIN_HOST / LAIN_PORT", "0.0.0.0 / 3100", "API and web listener"],
  ["LAIN_PUBLIC_URL", "http://localhost:3100", "Public laind URL"],
  ["LAIN_DATABASE_URL", "./data/lain.db", "SQLite database and certificate parent directory"],
  ["LAIN_DNS_HOST / LAIN_DNS_PORT", "0.0.0.0 / 5353", "DNS listeners; installed service uses port 53"],
  ["LAIN_DNS_UPSTREAM", "1.1.1.1", "Forwarder for unmanaged queries"],
  ["LAIN_DNS_RECORD_ADDRESS", "127.0.0.1", "Address returned for local proxied services"],
  ["LAIN_PROXY_HOST / LAIN_PROXY_PORT", "0.0.0.0 / 8080", "HTTP proxy; installed service uses port 80"],
  ["LAIN_PROXY_TLS_PORT", "8443", "HTTPS listener; installed service uses port 443"],
  ["LAIN_RECONCILE_INTERVAL_MS", "30000", "Desired-state reconciliation interval"],
  ["LAIN_HEALTH_INTERVAL_MS", "30000", "Upstream health-check interval"],
  ["LAIN_ADAPTER_MODE", "mock", "Use live to enable external Cloudflare and ACME mutations"],
  ["CLOUDFLARE_API_TOKEN", "—", "Development fallback; use a systemd credential in production"],
  ["CLOUDFLARE_ZONE_ID", "—", "Zone containing managed hostnames"],
  ["CLOUDFLARE_ACCOUNT_ID", "—", "Account containing the Tunnel"],
  ["CLOUDFLARE_TUNNEL_ID", "—", "Existing Tunnel managed by Lain"],
  ["CLOUDFLARE_TUNNEL_CNAME", "<tunnel-id>.cfargotunnel.com", "Optional explicit Tunnel DNS target"],
  ["ACME_EMAIL", "—", "Let's Encrypt account email"],
  ["LAIN_URL", "http://localhost:3100", "API URL used by lainctl"]
] as const;

export function Docs() {
  const [addresses, setAddresses] = useState<SystemSetup["addresses"]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [registeredServices, setRegisteredServices] = useState<ServiceWithStatus[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  useEffect(() => { void api.systemSetup().then((setup) => { setAddresses(setup.addresses); setSelectedAddress((current) => current || setup.addresses[0]?.address || ""); }).catch(() => undefined); }, []);
  useEffect(() => { void api.services().then((services) => { const routes = services.filter((service) => service.dnsEnabled); setRegisteredServices(routes); setSelectedServiceId((current) => current || routes[0]?.id || ""); }).catch(() => undefined); }, []);
  const selected = addresses.find(({ address }) => address === selectedAddress) ?? addresses[0];
  const selectedService = registeredServices.find(({ id }) => id === selectedServiceId) ?? registeredServices[0];
  const hostAddress = selected?.address ?? "LAIN_HOST_IP";
  const lanNetwork = selected?.network ?? "YOUR_LAN_CIDR";
  const registeredHostname = selectedService?.hostname ?? "REGISTERED_HOSTNAME";
  const registeredScheme = selectedService?.tlsEnabled ? "https" : "http";
  return <>
    <header className="docs-masthead relative mb-12 overflow-hidden border-y border-wired-400/15 py-10 sm:py-14">
      <div className="relative z-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
        <div><div className="font-mono text-[10px] uppercase tracking-[.32em] text-wired-400/65">The Wired / Operator manual</div><h1 className="mt-5 max-w-2xl font-mono text-4xl font-medium leading-[.92] tracking-[-.07em] text-[#dcece7] sm:text-6xl">READ THE<br/><span className="text-wired-400/75">PROTOCOL.</span></h1><p className="mt-6 max-w-2xl text-sm leading-7 text-white/40">A practical manual for declaring services, understanding reconciliation, and operating this node without leaving the interface.</p></div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-l border-white/10 pl-5 font-mono text-[10px] uppercase tracking-wider md:grid-cols-1"><div><dt className="text-white/25">Revision</dt><dd className="mt-1 text-white/60">MVP 0.1.0</dd></div><div><dt className="text-white/25">Sections</dt><dd className="mt-1 text-white/60">01—09</dd></div><div><dt className="text-white/25">Node</dt><dd className="mt-1 text-wired-400/70">Home / online</dd></div></dl>
      </div>
    </header>

    <div className="grid items-start gap-8 xl:grid-cols-[170px_minmax(0,850px)] xl:justify-center xl:gap-16">
      <nav className="-mx-5 mb-4 flex overflow-x-auto border-y border-white/[.07] bg-[#06100f]/95 px-5 py-2 backdrop-blur xl:sticky xl:top-8 xl:mx-0 xl:mb-0 xl:block xl:border-y-0 xl:border-l xl:bg-transparent xl:px-0 xl:py-1" aria-label="Documentation sections">
        <div className="hidden px-4 pb-4 font-mono text-[9px] uppercase tracking-[.22em] text-white/25 xl:block">Contents</div>
        {navigation.map(([id, label], index) => <a key={id} href={`#${id}`} className="group flex shrink-0 items-center gap-2 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-white/35 transition hover:text-wired-400 xl:px-4"><span className="text-white/15 transition group-hover:text-wired-400/40">0{index + 1}</span>{label}</a>)}
      </nav>

      <article className="min-w-0">
        <DocSection id="start" eyebrow="01 / Boot" title="Quick start">
          <p>Development requires Node.js 22 or newer and pnpm 10 or newer. Mock mode is enabled by default, so no Cloudflare credentials are needed.</p>
          <Code>{`pnpm install
cp .env.example .env
pnpm dev`}</Code>
          <div className="grid gap-6 sm:grid-cols-3"><Fact label="Dashboard" value="localhost:5173"/><Fact label="API" value="localhost:3100"/><Fact label="Proxy / dev" value=":8080 HTTP · :8443 HTTPS"/></div>
          <Callout icon={<CheckCircle2 size={17}/>} title="Safe by default">Mock adapters report intended Cloudflare and ACME operations without changing external systems. Local DNS, proxying, persistence, and health checks remain real.</Callout>
        </DocSection>

        <DocSection id="model" eyebrow="02 / Signal path" title="How it works">
          <p>A Service is Lain's single source of truth. The reconciler passes it to independent adapters; those adapters compare desired state with the real system and record what happened.</p>
          <div className="overflow-hidden border-y border-white/[.08] bg-black/15 font-mono text-xs leading-7 text-white/55">
            <div className="border-b border-white/[.07] px-5 py-3 text-[10px] uppercase tracking-[.2em] text-wired-400/60">State propagation</div>
            <pre className="overflow-x-auto p-5 text-[11px] sm:text-xs">{`Dashboard / lainctl
         │
         ▼
     laind API ──────► SQLite service registry
         │
         ├──► local DNS + DNS-over-HTTPS
         ├──► HTTP(S) / WebSocket proxy
         ├──► health checker
         └──► reconciler
                  ├── Cloudflare DNS
                  ├── Let's Encrypt DNS-01
                  └── Cloudflare Tunnel ingress`}</pre>
          </div>
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-3"><Concept icon={<Network/>} title="Desired state">Your service form declares what should exist.</Concept><Concept icon={<Code2/>} title="Observed state">Component rows show what each adapter actually found or changed.</Concept><Concept icon={<ArrowRight/>} title="Reconciliation">Drift is periodically detected and corrected.</Concept></div>
        </DocSection>

        <DocSection id="services" eyebrow="03 / Registry" title="Service model">
          <p>Every service names an upstream and selects which derived components Lain should own. The hostname is the stable identity used by DNS, proxying, TLS, and Tunnel ingress.</p>
          <div className="grid gap-6 sm:grid-cols-3"><Fact label="Internal" value="Local DNS only"/><Fact label="Private" value="Cloudflare DNS optional"/><Fact label="Public" value="Proxy or Tunnel exposure"/></div>
          <div className="overflow-hidden border-y border-white/[.08]"><table className="w-full text-left text-xs"><thead className="bg-black/15 font-mono uppercase tracking-wider text-white/30"><tr><th className="px-4 py-3">Component</th><th className="px-4 py-3">Responsibility</th></tr></thead><tbody className="divide-y divide-white/[.06] text-white/50"><Row name="DNS" detail="Synthesizes local A records and optionally manages Cloudflare records."/><Row name="Proxy" detail="Routes HTTP and WebSocket traffic by hostname to the declared target."/><Row name="TLS" detail="Issues Let's Encrypt certificates through Cloudflare DNS-01."/><Row name="Tunnel" detail="Points managed Cloudflare Tunnel ingress to Lain's local proxy."/><Row name="Health" detail="Checks the target and records a healthy, unhealthy, or pending result."/></tbody></table></div>
          <Link to="/services/new" className="btn-primary"><ArrowRight size={15}/>Declare a service</Link>
        </DocSection>

        <DocSection id="host-setup" eyebrow="04 / Host" title="Secure Ubuntu setup">
          <p>The dashboard can inspect host readiness and display remediation, but it cannot run privileged commands. Copy a suggested command and approve it in a local terminal.</p>
          <Callout icon={<LockKeyhole size={17}/>} title="Secret boundary">Tokens are accepted only through local files. They never pass through the browser, API, command arguments, shell evaluation, or logs.</Callout>
          <h3 className="font-medium text-white/75">Install laind</h3><Code>{`pnpm build
sudo node apps/cli/dist/main.js setup ubuntu \\
  --install-laind \\
  --dns-address ${hostAddress}`}</Code>
          <p>The detected address <InlineCode>{hostAddress}</InlineCode> is inserted automatically. The installed service listens on DNS <InlineCode>:53</InlineCode>, HTTP <InlineCode>:80</InlineCode>, and HTTPS <InlineCode>:443</InlineCode>. It stays unprivileged and receives only <InlineCode>CAP_NET_BIND_SERVICE</InlineCode>. Development keeps <InlineCode>:5353</InlineCode>, <InlineCode>:8080</InlineCode>, and <InlineCode>:8443</InlineCode> so <InlineCode>pnpm dev</InlineCode> never needs sudo.</p>
          <h3 className="font-medium text-white/75">Install cloudflared</h3><Code>{`sudo node apps/cli/dist/main.js setup ubuntu --install-cloudflared`}</Code>
          <h3 className="font-medium text-white/75">Configure a remotely managed Tunnel</h3><Code>{`sudo node apps/cli/dist/main.js setup ubuntu \\
  --tunnel-token-file /root/cloudflare-tunnel-token \\
  --cloudflare-api-token-file /root/cloudflare-api-token \\
  --zone-id YOUR_ZONE_ID \\
  --account-id YOUR_ACCOUNT_ID \\
  --tunnel-id YOUR_TUNNEL_ID \\
  --live`}</Code>
          <p>The installer supports Ubuntu and Debian, previews its allowlisted changes, uses Cloudflare's signed APT repository, and refuses to overwrite unmanaged system files unless you explicitly pass <InlineCode>--replace</InlineCode>.</p>
          <p>Secrets are copied to <InlineCode>/etc/lain/credentials</InlineCode> with mode <InlineCode>0600</InlineCode>. systemd passes them through <InlineCode>LoadCredential</InlineCode>; non-secret identifiers live in <InlineCode>/etc/lain/lain.env</InlineCode>.</p>
        </DocSection>

        <DocSection id="proxmox" eyebrow="05 / Container" title="Install as a Proxmox LXC">
          <p>Run Lain in a small unprivileged Debian container instead of maintaining a full VM. The repository includes a Proxmox host bootstrap that creates the container, installs a verified Node.js 22 release, builds Lain, and enables its systemd service.</p>
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2"><Concept icon={<Box/>} title="No nested runtime">The container does not use Docker or enable nesting. Proxmox provides its network and filesystem isolation directly.</Concept><Concept icon={<LockKeyhole/>} title="Secrets arrive later">The bootstrap accepts no Cloudflare secrets. Import token files directly into the finished container after reviewing the deployment.</Concept></div>
          <Callout icon={<Server size={17}/>} title="Run on the Proxmox host">Publish the repository first and reserve a static LAN address. The guided launcher offers Default and Advanced profiles, previews the complete plan, and asks before creating anything.</Callout>
          <Code>{`bash -c "$(curl -fsSL \\
  https://raw.githubusercontent.com/Dragonshorn-Studios/lain/main/deploy/proxmox/install.sh)"`}</Code>
          <p>This opens the Community-Scripts-style interactive flow. It has no telemetry and does not accept Cloudflare credentials. Running a remote script as Proxmox <InlineCode>root</InlineCode> still trusts that repository branch; inspect-before-running and commit-pinned commands are in <InlineCode>deploy/proxmox/README.md</InlineCode>.</p>
          <p>Choose an unused, reserved LAN address when prompted. The default container has two cores, 1 GiB RAM, an 8 GiB disk, and starts automatically with the Proxmox host. It listens on DNS <InlineCode>:53</InlineCode>, HTTP <InlineCode>:80</InlineCode>, HTTPS <InlineCode>:443</InlineCode>, and serves this dashboard on <InlineCode>:3100</InlineCode>. Keep the dashboard/API reachable only from a trusted network.</p>
          <h3 className="font-medium text-white/75">Persistent Cloudflare setup</h3>
          <Code>{`# Example for container ID 220; run on the Proxmox host
pct push 220 /root/cloudflare-tunnel-token /root/cloudflare-tunnel-token --perms 0600
pct push 220 /root/cloudflare-api-token /root/cloudflare-api-token --perms 0600

pct exec 220 -- node /opt/lain/apps/cli/dist/main.js setup ubuntu \\
  --tunnel-token-file /root/cloudflare-tunnel-token \\
  --cloudflare-api-token-file /root/cloudflare-api-token \\
  --zone-id YOUR_ZONE_ID --account-id YOUR_ACCOUNT_ID \\
  --tunnel-id YOUR_TUNNEL_ID --live --yes

pct exec 220 -- rm -- /root/cloudflare-tunnel-token /root/cloudflare-api-token`}</Code>
          <p>Imported credentials are stored under <InlineCode>/etc/lain/credentials</InlineCode>, configuration under <InlineCode>/etc/lain/lain.env</InlineCode>, and application state under <InlineCode>/var/lib/lain</InlineCode>. Back up the container normally in Proxmox. See the repository's <InlineCode>deploy/proxmox/README.md</InlineCode> for cleanup, verification, updates, and recovery.</p>
          <p>Container creation follows the <External href="https://pve.proxmox.com/pve-docs/pct.1.html">official Proxmox pct documentation</External>.</p>
        </DocSection>

        <DocSection id="client-dns" eyebrow="06 / Resolver" title="Connect machines to Lain DNS">
          <p>Lain is an authoritative resolver for managed internal and private names, and forwards everything else upstream. Clients must use the Lain host's LAN address as their DNS server on standard port <InlineCode>53</InlineCode>.</p>
          <div className="border-y border-white/[.08] py-5"><div className="font-mono text-[9px] uppercase tracking-[.2em] text-white/25">Detected host addresses</div>{addresses.length ? <div className="mt-3 flex flex-wrap gap-2">{addresses.map((item) => <button key={`${item.interface}-${item.address}`} type="button" onClick={() => setSelectedAddress(item.address)} className={`rounded border px-3 py-2 font-mono text-[10px] transition ${item.address === hostAddress ? "border-wired-400/30 bg-wired-400/[.08] text-wired-400" : "border-white/10 text-white/40 hover:border-wired-400/20 hover:text-white/65"}`}><span className="text-white/25">{item.interface}</span> · {item.address}{item.network ? ` · ${item.network}` : ""}</button>)}</div> : <p className="mt-2 font-mono text-xs text-amber-200/60">No non-loopback IPv4 address was detected. Replace LAIN_HOST_IP and YOUR_LAN_CIDR manually.</p>}</div>
          <Callout icon={<Router size={17}/>} title="Recommended: configure DHCP">Reserve a stable address for the Lain host, then set that address as the DNS server handed out by your router's DHCP service. Renew client leases or reconnect them. This configures every device—including phones and TVs—without per-device maintenance.</Callout>

          <h3 className="font-medium text-white/75">1. Prepare the Lain host</h3>
          <Code>{`# Detected from the selected host interface above
sudo node apps/cli/dist/main.js setup ubuntu \\
  --install-laind \\
  --dns-address ${hostAddress}

# If UFW is enabled, allow DNS from the LAN only
sudo ufw allow from ${lanNetwork} to any port 53 proto udp
sudo ufw allow from ${lanNetwork} to any port 53 proto tcp`}</Code>
          <p><InlineCode>LAIN_DNS_RECORD_ADDRESS</InlineCode> must be the Lain host's LAN address—not <InlineCode>127.0.0.1</InlineCode>. Managed names resolve to this address so traffic reaches Lain's hostname-based reverse proxy.</p>

          <h3 className="font-medium text-white/75">2. Configure clients</h3>
          <div className="divide-y divide-white/[.08] border-y border-white/[.08]">
            <DnsGuide icon={<Router/>} title="Router / DHCP" recommended><p>In your router's LAN or DHCP settings, set the primary DNS server to <InlineCode>{hostAddress}</InlineCode>. Do not use the WAN DNS setting unless your router explicitly documents that it distributes that value to clients.</p><p>After saving, renew DHCP leases or disconnect and reconnect each device.</p></DnsGuide>
            <DnsGuide icon={<Laptop/>} title="Ubuntu / NetworkManager"><Code>{`nmcli connection show
sudo nmcli connection modify "YOUR CONNECTION" \\
  ipv4.dns "${hostAddress}" \\
  ipv4.ignore-auto-dns yes
sudo nmcli connection up "YOUR CONNECTION"`}</Code><p>To revert: set <InlineCode>ipv4.dns ""</InlineCode> and <InlineCode>ipv4.ignore-auto-dns no</InlineCode>. NetworkManager documents these settings in its <External href="https://www.networkmanager.dev/docs/api/latest/nm-settings-nmcli.html">nmcli reference</External>.</p></DnsGuide>
            <DnsGuide icon={<Terminal/>} title="Linux / temporary systemd-resolved test"><Code>{`ip link
sudo resolvectl dns eno1 ${hostAddress}
sudo resolvectl domain eno1 '~.'

# Revert this temporary per-link configuration
sudo resolvectl revert eno1`}</Code><p>Replace <InlineCode>eno1</InlineCode> with the active interface. The <InlineCode>~.</InlineCode> routing domain sends all DNS through Lain, which forwards unmanaged queries upstream.</p></DnsGuide>
            <DnsGuide icon={<Laptop/>} title="macOS"><Code>{`networksetup -listallnetworkservices
sudo networksetup -setdnsservers "Wi-Fi" ${hostAddress}

# Revert to DHCP-provided DNS
sudo networksetup -setdnsservers "Wi-Fi" empty`}</Code><p>You can also use System Settings → Network → your connection → Details → DNS. See <External href="https://support.apple.com/guide/mac-help/mh14127/mac">Apple's DNS settings guide</External>.</p></DnsGuide>
            <DnsGuide icon={<Monitor/>} title="Windows / PowerShell as Administrator"><Code>{`Get-NetAdapter
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses "${hostAddress}"

# Revert to DHCP-provided DNS
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ResetServerAddresses`}</Code><p>Replace <InlineCode>Ethernet</InlineCode> with the active adapter name. See Microsoft's <External href="https://learn.microsoft.com/powershell/module/dnsclient/set-dnsclientserveraddress">DNS client cmdlet reference</External>.</p></DnsGuide>
            <DnsGuide icon={<Laptop/>} title="Phones, tablets, and appliances"><p>Prefer router DHCP. For a single device, edit the connected Wi-Fi network, choose manual/static DNS, and enter <InlineCode>{hostAddress}</InlineCode>. Avoid changing the IP assignment itself unless the OS requires it.</p></DnsGuide>
          </div>

          <h3 className="font-medium text-white/75">3. Verify resolution</h3>
          <div className="border-y border-white/[.08] py-5"><div className="font-mono text-[9px] uppercase tracking-[.2em] text-white/25">Registered DNS route</div>{registeredServices.length ? <div className="mt-3 flex flex-wrap gap-2">{registeredServices.map((service) => <button key={service.id} type="button" onClick={() => setSelectedServiceId(service.id)} className={`rounded border px-3 py-2 font-mono text-[10px] transition ${service.id === selectedService?.id ? "border-wired-400/30 bg-wired-400/[.08] text-wired-400" : "border-white/10 text-white/40 hover:border-wired-400/20 hover:text-white/65"}`}><span className="text-white/25">{service.name}</span> · {service.hostname}</button>)}</div> : <p className="mt-2 text-xs text-amber-200/60">No DNS-enabled services are registered yet. <Link to="/services/new" className="text-wired-400 hover:text-[#a2ddd4]">Declare a service</Link> to get a copy-paste verification command.</p>}</div>
          <Code>{`# Query Lain directly first
dig @${hostAddress} ${registeredHostname}

# Then verify the operating system is using Lain
nslookup ${registeredHostname}

# Finally verify proxy routing
curl -I ${registeredScheme}://${registeredHostname}`}</Code>
          <p>If the direct <InlineCode>dig</InlineCode> query works but the normal lookup fails, the client or DHCP configuration is wrong. If lookup succeeds but HTTP fails, check <Link to="/services" className="text-wired-400 hover:text-wired-400/80">service health and proxy state</Link>.</p>
        </DocSection>

        <DocSection id="configuration" eyebrow="07 / Environment" title="Configuration reference">
          <p>Development can use a local <InlineCode>.env</InlineCode>. The hardened systemd installation reads non-secret settings from <InlineCode>/etc/lain/lain.env</InlineCode> and the API token from its credential directory.</p>
          <div className="overflow-hidden border-y border-white/[.08]"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-black/15 font-mono uppercase tracking-wider text-white/30"><tr><th className="px-4 py-3">Variable</th><th className="px-4 py-3">Default</th><th className="px-4 py-3">Purpose</th></tr></thead><tbody className="divide-y divide-white/[.06] text-white/50">{environment.map(([name, value, detail]) => <tr key={name}><td className="px-4 py-3 font-mono text-wired-400/75">{name}</td><td className="px-4 py-3 font-mono text-white/35">{value}</td><td className="px-4 py-3">{detail}</td></tr>)}</tbody></table></div></div>
        </DocSection>

        <DocSection id="operations" eyebrow="08 / Control" title="Operations">
          <Code>{`pnpm lainctl status
pnpm lainctl services
pnpm lainctl reconcile
pnpm lainctl reconcile SERVICE_ID`}</Code>
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2"><Concept icon={<Terminal/>} title="Reconcile now">The dashboard refresh only reloads observed state. Use reconcile to actively run adapters again.</Concept><Concept icon={<Cloud/>} title="cloudflared ownership">The API updates Tunnel ingress through Cloudflare, while cloudflared remains a separately supervised system service.</Concept></div>
          <Callout icon={<AlertTriangle size={17}/>} title="Current boundaries">One node owns one Cloudflare zone and one existing Tunnel. DNS synthesizes IPv4 A records. External cleanup after deleting a service remains intentionally deferred.</Callout>
        </DocSection>

        <DocSection id="security" eyebrow="09 / Trust" title="Security model">
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2"><Concept icon={<Server/>} title="Trusted network">Lain currently has no authentication. Bind it to a trusted network or place it behind an authenticated gateway.</Concept><Concept icon={<LockKeyhole/>} title="Least privilege">Give the Cloudflare token only DNS edit and Tunnel edit permissions for the selected resources.</Concept></div>
          <ul className="list-disc space-y-2 pl-5"><li>Do not expose the API directly to the public internet.</li><li>Keep credential source files, <InlineCode>.env</InlineCode>, the database, and certificate directory private.</li><li>Remove temporary source token files after host setup succeeds.</li><li>Review setup plans before confirmation; reserve <InlineCode>--yes</InlineCode> for audited automation.</li></ul>
        </DocSection>
      </article>
    </div>
  </>;
}

function DocSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) { return <section id={id} className="scroll-mt-8 space-y-6 border-t border-white/[.08] py-14 text-[15px] leading-8 text-white/50 first:border-t-0 first:pt-0"><div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-baseline"><div className="font-mono text-[9px] uppercase tracking-[.24em] text-wired-400/50">{eyebrow}</div><h2 className="text-2xl font-semibold tracking-tight text-white/90 sm:text-3xl">{title}</h2></div>{children}</section>; }
function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const fallback = () => { const input = document.createElement("textarea"); input.value = children; input.style.position = "fixed"; input.style.opacity = "0"; document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove(); };
    try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(children); else fallback(); }
    catch { fallback(); }
    setCopied(true); window.setTimeout(() => setCopied(false), 1_500);
  };
  return <div className="relative"><pre className="overflow-x-auto border-l-2 border-wired-400/25 bg-black/20 py-4 pl-5 pr-12 font-mono text-xs leading-6 text-[#b9d8d0]"><code>{children}</code></pre><button type="button" onClick={() => void copy()} className="absolute right-3 top-3 grid h-8 w-8 place-items-center border border-white/10 bg-black/30 text-white/35 transition hover:border-wired-400/25 hover:text-wired-400" title="Copy command" aria-label="Copy command">{copied ? <Check size={14}/> : <Copy size={14}/>}</button></div>;
}
function InlineCode({ children }: { children: ReactNode }) { return <code className="rounded bg-wired-400/[.07] px-1.5 py-0.5 font-mono text-[.9em] text-wired-400/80">{children}</code>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="border-l border-wired-400/20 pl-4"><div className="font-mono text-[9px] uppercase tracking-[.18em] text-white/25">{label}</div><div className="mt-1 text-sm font-medium text-white/75">{value}</div></div>; }
function Concept({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <div className="border-t border-white/[.08] pt-4"><div className="mb-3 text-wired-400/55">{icon}</div><div className="text-sm font-medium text-white/80">{title}</div><p className="mt-1 text-xs leading-5 text-white/40">{children}</p></div>; }
function Callout({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <div className="flex gap-4 border-l-2 border-wired-400/30 bg-gradient-to-r from-wired-400/[.05] to-transparent px-5 py-4"><div className="mt-0.5 shrink-0 text-wired-400/65">{icon}</div><div><div className="text-sm font-medium text-white/75">{title}</div><p className="mt-1 text-xs leading-5 text-white/45">{children}</p></div></div>; }
function Row({ name, detail }: { name: string; detail: string }) { return <tr><td className="px-4 py-3 font-medium text-white/70">{name}</td><td className="px-4 py-3">{detail}</td></tr>; }
function DnsGuide({ icon, title, recommended, children }: { icon: ReactNode; title: string; recommended?: boolean; children: ReactNode }) { return <section className="grid gap-4 py-7 sm:grid-cols-[180px_1fr]"><div><div className="text-wired-400/55">{icon}</div><h4 className="mt-2 text-sm font-medium text-white/75">{title}</h4>{recommended && <span className="mt-2 inline-block font-mono text-[8px] uppercase tracking-wider text-wired-400/65">Preferred</span>}</div><div className="min-w-0 space-y-3 text-xs leading-6 text-white/45">{children}</div></section>; }
function External({ href, children }: { href: string; children: ReactNode }) { return <a href={href} target="_blank" rel="noreferrer" className="text-wired-400 underline decoration-wired-400/25 underline-offset-4 hover:text-[#a2ddd4]">{children}</a>; }
