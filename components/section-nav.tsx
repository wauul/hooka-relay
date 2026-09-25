"use client";
import { T } from "./preferences";
import { useEffect, useState } from "react";
import { Activity, Radio, List, KeyRound, Settings, Users, Mail, BookOpen, Code2, RefreshCw, Terminal, Webhook, type LucideIcon } from "lucide-react";
const icons: Record<string, LucideIcon> = { overview: Activity, customers: Users, endpoints: Radio, events: List, security: KeyRound, settings: Settings, members: Users, invitations: Mail, sources: Webhook, send: BookOpen, signatures: KeyRound, retries: RefreshCw, "api-reference": Code2, tooling: Terminal, faq: BookOpen };
export function useSection(names: readonly string[]) {
  const [section, setSection] = useState(names[0]);
  const allowed = names.join(",");
  useEffect(() => {
    const read = () => { const value = window.location.hash.slice(1); setSection(allowed.split(",").includes(value) ? value : allowed.split(",")[0]); };
    read(); window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, [allowed]);
  return section;
}
export function SectionNav({ active, items }: { active: string; items: { id: string; label: string }[] }) {
  return <nav className="section-nav" aria-label="Page sections">{items.map(({ id, label }) => { const Icon = icons[id]; return <a key={id} href={`#${id}`} aria-current={active === id ? "page" : undefined} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`); window.dispatchEvent(new Event("hashchange")); }}><Icon size={16} aria-hidden="true" /><T text={label} /></a>; })}</nav>;
}
// Keep panels mounted: switching sections must not discard a newly revealed key or draft form.
export function Section({ active, name, children }: { active: string; name: string; children: React.ReactNode }) {
  return <div className="section-panel" data-section={name} hidden={active !== name}>{children}</div>;
}
