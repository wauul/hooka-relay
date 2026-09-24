"use client";
import { T } from "@/components/preferences";
import { Braces, Gauge, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { api, ErrorBox } from "./ui";
import { Select } from "./select";

export function EndpointOptions({ endpoint, reload }: { endpoint: { id: string; role: string; environment: string; kind: string; deliveryRatePerMinute: number | null; customHeaders?: Record<string, string>; transform: string | null }; reload: () => Promise<unknown> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <section className="visual-card endpoint-setting-card"><div className="visual-card-top"><span>Delivery configuration</span><span className="visual-card-icon"><SlidersHorizontal size={18} /></span></div><div className="endpoint-option-metrics"><div><Gauge size={16} /><strong>{endpoint.deliveryRatePerMinute ? `${endpoint.deliveryRatePerMinute}/min` : "No limit"}</strong><small>Rate limit</small></div><div><Braces size={16} /><strong>{endpoint.transform ? "Enabled" : "Off"}</strong><small>Transform</small></div></div><p className="visual-card-caption">{endpoint.environment} · {endpoint.kind === "OPERATIONAL" ? "Operational notifications" : "Application events"} · {Object.keys(endpoint.customHeaders || {}).length} custom headers</p><ErrorBox error={error} />
    {endpoint.role !== "MEMBER" && <details className="inspector-detail"><summary>Edit delivery configuration</summary><form className="endpoint-options-form" key={endpoint.id + endpoint.environment + endpoint.kind} onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); const f = new FormData(e.currentTarget); try { await api(`/api/endpoints/${endpoint.id}/configuration`, { environment: f.get("environment"), kind: f.get("kind"), deliveryRatePerMinute: f.get("rate") ? Number(f.get("rate")) : null, customHeaders: JSON.parse(String(f.get("headers"))), transform: String(f.get("transform")).trim() || null }, "PATCH"); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <div className="field"><Select label="Environment" name="environment" defaultValue={endpoint.environment} options={[{ value: "development", label: "Development" }, { value: "staging", label: "Staging" }, { value: "production", label: "Production" }, ...(["development", "staging", "production"].includes(endpoint.environment) ? [] : [{ value: endpoint.environment, label: `${endpoint.environment} (existing)` }])]} /></div>
      <div className="field"><Select label="Endpoint kind" name="kind" defaultValue={endpoint.kind} options={[{ value: "BUSINESS", label: "Application events" }, { value: "OPERATIONAL", label: "Operational notifications" }]} /></div>
      <div className="field"><label htmlFor="endpoint-rate">Maximum deliveries per minute</label><input id="endpoint-rate" name="rate" type="number" min={1} max={6000} defaultValue={endpoint.deliveryRatePerMinute || ""} placeholder="No limit" /></div>
      <div className="field"><label htmlFor="endpoint-headers"><T text={"Custom headers (JSON)"} /></label><textarea id="endpoint-headers" name="headers" rows={4} maxLength={8192} defaultValue={JSON.stringify(endpoint.customHeaders || {}, null, 2)} /></div>
      <div className="field"><label htmlFor="endpoint-transform"><T text={"Optional payload transform"} /></label><textarea id="endpoint-transform" name="transform" rows={5} maxLength={4096} defaultValue={endpoint.transform || ""} placeholder={'payload => ({ order: payload.orderId })'} /></div>
      <p className="muted">Transforms run before signing. Invalid transforms cause failed attempts.</p><button className="btn secondary" disabled={busy}><T text={"Save delivery configuration"} /></button>
    </form></details>}
  </section>;
}
