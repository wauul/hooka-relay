"use client";
import { T } from "./preferences";
import { useEffect, useState } from "react";
import { Activity, Radio, List, KeyRound, Settings } from "lucide-react";
const icons = { overview: Activity, endpoints: Radio, events: List, security: KeyRound, settings: Settings };
export function useSection(names: readonly string[]) {
  const [section, setSection] = useState(names[0]);
  const allowed = names.join(",");
  useEffect(() => {
    const read = () => { const value = window.location.hash.slice(1); setSection(allowed.split(",").includes(value) ? value : allowed.split(",")[0]); };
    read(); window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [allowed]);
  return section;
}
export function SectionNav({ active, items }: { active: string; items: { id: keyof typeof icons; label: string }[] }) {
  return <nav className="section-nav" aria-label="Page sections">{items.map(({ id, label }) => { const Icon = icons[id]; return <a key={id} href={`#${id}`} aria-current={active === id ? "page" : undefined}><Icon size={16} aria-hidden="true" /><T text={label} /></a>; })}</nav>;
}
// Keep panels mounted: switching sections must not discard a newly revealed key or draft form.
export function Section({ active, name, children }: { active: string; name: string; children: React.ReactNode }) {
  return <div className="section-panel" data-section={name} hidden={active !== name}>{children}</div>;
}
