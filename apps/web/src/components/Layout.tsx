import { Activity, BookOpen, Boxes, CircuitBoard, Github } from "lucide-react";
import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function Layout({ children }: PropsWithChildren) {
  return <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
    <aside className="wired-sidebar border-b border-white/10 px-5 py-4 lg:fixed lg:inset-y-0 lg:w-[240px] lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
      <div className="flex items-center gap-3"><div className="logo-signal grid h-10 w-10 place-items-center border border-wired-500/30 bg-wired-500/10" aria-label="Lain hair clip"><span className="lain-hairclip" aria-hidden="true"/></div><div><div className="font-mono text-xl font-semibold tracking-[.08em]">lain</div><div className="font-mono text-[10px] uppercase tracking-[.24em] text-white/35">serial interface</div></div></div>
      <nav className="mt-6 flex gap-2 lg:mt-12 lg:flex-col">
        <NavItem to="/" icon={<Activity size={17}/>} label="Overview" />
        <NavItem to="/services" icon={<Boxes size={17}/>} label="Services" />
        <NavItem to="/docs" icon={<BookOpen size={17}/>} label="Docs" />
      </nav>
      <div className="mt-8 hidden border-t border-white/10 pt-6 text-xs leading-5 text-white/35 lg:block"><div className="mb-2 flex items-center gap-2 font-mono text-wired-400/70"><CircuitBoard size={14}/> NODE: HOME</div>Service intent becomes network state.</div>
      <a className="absolute bottom-7 hidden items-center gap-2 text-xs text-white/30 hover:text-white/60 lg:flex" href="https://github.com" target="_blank"><Github size={14}/> MVP 0.1.0</a>
    </aside>
    <main className="lg:col-start-2"><div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</div></main>
  </div>;
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return <NavLink to={to} end={to === "/"} className={({ isActive }) => `flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${isActive ? "border-wired-400/15 bg-wired-500/10 text-wired-400" : "border-transparent text-slate-300/50 hover:border-wired-400/10 hover:bg-wired-400/[.055] hover:text-[#d7eeea]"}`}>{icon}<span>{label}</span></NavLink>;
}
