"use client";
import { T } from "@/components/preferences";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api, CopyButton } from "./ui";
export function EndpointSigning({ endpoint, reload }: { endpoint: { id: string; role: string; signatureFormat: string; previousSecretExpiresAt: string | null }; reload: () => Promise<unknown> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [secret, setSecret] = useState("");
  async function action(path: string, data: unknown, method: string) {
    setBusy(true); setError(""); try { const result = await api(`/api/endpoints/${endpoint.id}/${path}`, data, method); if (result.secret) setSecret(result.secret); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel panel-body"><h2><T text={"Signing & rotation"} /></h2><p>Format: {endpoint.signatureFormat}. Existing receivers must be updated before switching formats.</p>
    {endpoint.previousSecretExpiresAt && <p>Previous key remains signed until {new Date(endpoint.previousSecretExpiresAt).toLocaleString()}. Update your receiver before this time.</p>}
    {endpoint.role !== "MEMBER" && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}><button className="btn secondary" disabled={busy} onClick={() => action("signature-format", { signatureFormat: endpoint.signatureFormat === "LEGACY" ? "STANDARD" : "LEGACY" }, "PATCH")}>Switch to {endpoint.signatureFormat === "LEGACY" ? "Standard Webhooks" : "legacy"}</button><button className="btn secondary" disabled={busy} onClick={() => action("rotate-secret", {}, "POST")}><KeyRound size={16} aria-hidden="true" /><T text={"Rotate signing secret"} /></button></div>}
    {secret && <p className="mono" style={{ overflowWrap: "anywhere" }}>New secret: {secret} <CopyButton value={secret} /></p>}{error && <p role="alert">{error}</p>}
  </section>;
}
