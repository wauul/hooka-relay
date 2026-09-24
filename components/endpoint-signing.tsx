"use client";
import { T } from "@/components/preferences";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, CopyButton, ErrorBox } from "./ui";

export function EndpointSigning({ endpoint, reload }: { endpoint: { id: string; role: string; previousSecretExpiresAt: string | null }; reload: () => Promise<unknown> }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [secret, setSecret] = useState("");
  async function action(path: string, data: unknown, method: string) {
    setBusy(true); setError(""); try { const result = await api(`/api/endpoints/${endpoint.id}/${path}`, data, method); if (result.secret) setSecret(result.secret); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="visual-card endpoint-setting-card"><div className="visual-card-top"><span>Signing</span><span className="visual-card-icon"><ShieldCheck size={18} /></span></div><div className="visual-card-value">Standard Webhooks</div><p className="visual-card-caption">Signed ID · timestamp · exact body</p>
    {endpoint.previousSecretExpiresAt && <div className="endpoint-signing-notice"><KeyRound size={17} /><span>Previous key valid until {new Date(endpoint.previousSecretExpiresAt).toLocaleString()}</span></div>}
    {endpoint.role !== "MEMBER" && <div className="endpoint-setting-actions"><button className="btn secondary" disabled={busy} onClick={() => action("rotate-secret", {}, "POST")}><KeyRound size={16} aria-hidden="true" /><T text={"Rotate signing secret"} /></button></div>}
    {secret && <div className="secret-row endpoint-new-secret"><code>{secret}</code><CopyButton value={secret} /></div>}<ErrorBox error={error} />
  </section>;
}
