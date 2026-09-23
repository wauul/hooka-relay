"use client";
import { T } from "@/components/preferences";
import { useState } from "react";
import { api, ErrorBox } from "./ui";
import { Select } from "./select";
export function EndpointOptions({ endpoint, reload }: { endpoint: { id: string; role: string; environment: string; kind: string; deliveryRatePerMinute: number | null; customHeaders?: Record<string, string>; transform: string | null }; reload: () => Promise<unknown> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <section className="panel panel-body" style={{ marginTop: 24 }}><h2><T text={"Delivery configuration"} /></h2><p className="muted">Environment: {endpoint.environment} · {endpoint.kind === "OPERATIONAL" ? "Operational notifications" : "Application events"}</p><ErrorBox error={error} />
    {endpoint.role !== "MEMBER" && <form key={endpoint.id + endpoint.environment + endpoint.kind} onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); const f = new FormData(e.currentTarget); try { await api(`/api/endpoints/${endpoint.id}/configuration`, { environment: f.get("environment"), kind: f.get("kind"), deliveryRatePerMinute: f.get("rate") ? Number(f.get("rate")) : null, customHeaders: JSON.parse(String(f.get("headers"))), transform: String(f.get("transform")).trim() || null }, "PATCH"); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <div className="field"><Select label="Environment" name="environment" defaultValue={endpoint.environment} options={[{ value: "development", label: "Development" }, { value: "staging", label: "Staging" }, { value: "production", label: "Production" }, ...(["development", "staging", "production"].includes(endpoint.environment) ? [] : [{ value: endpoint.environment, label: `${endpoint.environment} (existing)` }])]} /></div>
      <div className="field"><Select label="Endpoint kind" name="kind" defaultValue={endpoint.kind} options={[{ value: "BUSINESS", label: "Application events" }, { value: "OPERATIONAL", label: "Operational notifications" }]} /></div>
      <div className="field"><label htmlFor="endpoint-rate">Maximum deliveries per minute (blank for no throttle)</label><input id="endpoint-rate" name="rate" type="number" min={1} max={6000} defaultValue={endpoint.deliveryRatePerMinute || ""} /></div>
      <div className="field"><label htmlFor="endpoint-headers"><T text={"Custom headers (JSON)"} /></label><textarea id="endpoint-headers" name="headers" rows={4} maxLength={8192} defaultValue={JSON.stringify(endpoint.customHeaders || {}, null, 2)} /></div>
      <div className="field"><label htmlFor="endpoint-transform"><T text={"Optional payload transform"} /></label><textarea id="endpoint-transform" name="transform" rows={5} maxLength={4096} defaultValue={endpoint.transform || ""} placeholder={'payload => ({ order: payload.orderId })'} /></div>
      <p className="muted">Transforms run before signing, in an isolated JavaScript engine with no network or Node APIs. Limit: 25 ms, 16 MiB, 256 KiB output. Invalid transforms produce failed attempts. Operational subscriptions accept endpoint.disabled, endpoint.re-enabled and message.failed.</p><button className="btn secondary" disabled={busy}><T text={"Save delivery configuration"} /></button>
    </form>}
  </section>;
}
