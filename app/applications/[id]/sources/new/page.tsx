"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Search, Trash2 } from "lucide-react";
import { Shell } from "@/components/shell";
import { api, CopyButton, ErrorBox, useData } from "@/components/ui";
import { ProviderIcon } from "@/components/provider-icon";
import { useConfirm } from "@/components/site-tools";
import { CustomerSelect } from "@/components/application-customers";

type Provider = { name: string; displayName: string; icon: string; docsUrl: string; setupInstructions: string[]; testEventSupport: boolean };
type SourceDetail = { id: string; name: string; customerId: string | null; status: string; setupStep: number; ingestionUrl: string; destinationUrl: string | null; hasProviderSecret: boolean; hasVerificationToken: boolean; manualConfig: Record<string, string> | null; provider: Provider; lastVerifiedAt: string | null; attempts: { status: string; event: { id: string } }[] };
const titles = ["Choose provider", "Name source", "Ingestion URL", "Signing secret", "Destination", "Test", "Done"];

function GitHubRegistration({ sourceId, onConnected }: { sourceId: string; onConnected: () => void }) {
  const [owner, setOwner] = useState(""), [repository, setRepository] = useState(""), [token, setToken] = useState("");
  const [events, setEvents] = useState<string[]>(["push", "pull_request"]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <form className="wizard-manual" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/api/sources/${sourceId}/github-registration`, { owner: owner.trim(), repository: repository.trim(), token, events });
      setToken(""); onConnected();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }}>
    <h3>Set up GitHub automatically</h3>
    <p>Hooka Relay can create the repository webhook and signing secret for you. Create a fine grained GitHub token with <strong>Webhooks: read and write</strong> access to this repository. The token is used once and is not saved.</p>
    <div className="wizard-repo-fields"><label>Owner<input value={owner} onChange={event => setOwner(event.target.value)} required placeholder="octocat" /></label><label>Repository<input value={repository} onChange={event => setRepository(event.target.value)} required placeholder="hello-world" /></label></div>
    <label>Fine grained token<input type="password" value={token} onChange={event => setToken(event.target.value)} required autoComplete="off" /></label>
    <fieldset className="wizard-events"><legend>GitHub events</legend>{(["push", "pull_request", "issues", "issue_comment", "release", "workflow_run"] as const).map(value => <label key={value}><input type="checkbox" checked={events.includes(value)} onChange={event => setEvents(current => event.target.checked ? [...current, value] : current.filter(item => item !== value))} />{value.replaceAll("_", " ")}</label>)}</fieldset>
    <ErrorBox error={error} /><button className="btn secondary" disabled={busy || events.length === 0}>Create GitHub webhook</button>
    <p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a fine grained GitHub token ↗</a></p>
  </form>;
}
function TestStep({ sourceId, provider, hasDestination, onBack, onDone }: { sourceId: string; provider: Provider; hasDestination: boolean; onBack: () => void; onDone: () => Promise<void> }) {
  const { data, error } = useData<SourceDetail>(`/api/sources/${sourceId}`, true);
  const [simulationId, setSimulationId] = useState(""), [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const verified = !!data?.lastVerifiedAt;
  const simulation = !!simulationId && !!data?.attempts.some(attempt => attempt.event.id === simulationId && attempt.status === "SUCCESS");
  return <div className="wizard-card"><h2>Test the connection</h2><ErrorBox error={error || failure} />
    {provider.name === "GITHUB" && !verified && <GitHubRegistration sourceId={sourceId} onConnected={() => setGithubConnected(true)} />}
    {provider.name === "GITHUB" && githubConnected && <p className="notice">GitHub webhook created. Waiting for its signed ping or another event.</p>}
    {!hasDestination && <p>Local only: run <code>hooka listen --source {sourceId} --forward-to http://localhost:3000/webhooks</code>, then send a real provider event. You can add a public destination later.</p>}
    {provider.testEventSupport || !hasDestination ? <><p>Send a test event from {provider.displayName}. This page checks for a correctly signed event every few seconds.</p><div className="wizard-wait">{verified ? <><CheckCircle2 size={18} /> Verified event received</> : <>Waiting for a verified {provider.displayName} event…</>}</div></> : <><p>Send a real event from {provider.displayName}, or run a simulation to check the destination. A simulation does not verify the provider signature.</p><button className="btn secondary" disabled={busy} onClick={async () => { setBusy(true); setFailure(""); try { const result = await api<{eventId:string}>(`/api/sources/${sourceId}/simulate`, {}); setSimulationId(result.eventId); } catch (cause) { setFailure((cause as Error).message); } finally { setBusy(false); } }}>Simulate a test event</button>{simulationId && <div className="wizard-wait">{simulation ? <><CheckCircle2 size={18} /> Destination accepted the event</> : "Waiting for a successful delivery attempt…"}</div>}</>}
    <div className="wizard-actions"><button type="button" className="btn quiet" onClick={onBack}>Back</button><button className="btn" disabled={busy || !(verified || simulation)} onClick={async () => { setBusy(true); setFailure(""); try { await onDone(); } catch (cause) { setFailure((cause as Error).message); setBusy(false); } }}>Activate source <ArrowRight size={16} /></button></div>
  </div>;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: applicationId } = use(params);
  const { data: catalog, error: catalogError } = useData<Provider[]>("/api/webhook-providers");
  const [step, setStep] = useState(0), [search, setSearch] = useState(""), [provider, setProvider] = useState<Provider>();
  const [name, setName] = useState(""), [sourceId, setSourceId] = useState(""), [ingestionUrl, setIngestionUrl] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [secret, setSecret] = useState(""), [hasSecret, setHasSecret] = useState(false), [destinationUrl, setDestinationUrl] = useState("");
  const [verificationToken, setVerificationToken] = useState(""), [hasVerificationToken, setHasVerificationToken] = useState(false);
  const [signatureHeader, setSignatureHeader] = useState(""), [algorithm, setAlgorithm] = useState("sha256"), [encoding, setEncoding] = useState("hex");
  const [signaturePrefix, setSignaturePrefix] = useState(""), [signedPayload, setSignedPayload] = useState("body");
  const [timestampHeader, setTimestampHeader] = useState(""), [timestampFormat, setTimestampFormat] = useState("{timestamp}.{body}");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [loading, setLoading] = useState(true);
  const confirm = useConfirm();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("source");
    if (!id) { setLoading(false); return; }
    let active = true;
    api<SourceDetail>(`/api/sources/${id}`).then(source => {
      if (!active) return;
      if (source.status !== "SETUP_IN_PROGRESS" || source.id !== id || !source.ingestionUrl) throw new Error("This setup draft is unavailable");
      setSourceId(id); setName(source.name); setCustomerId(source.customerId || ""); setProvider(source.provider); setIngestionUrl(source.ingestionUrl);
      setDestinationUrl(source.destinationUrl || ""); setHasSecret(source.hasProviderSecret); setHasVerificationToken(source.hasVerificationToken);
      if (source.manualConfig) {
        setSignatureHeader(source.manualConfig.signatureHeader || ""); setAlgorithm(source.manualConfig.algorithm || "sha256");
        setEncoding(source.manualConfig.encoding || "hex"); setSignaturePrefix(source.manualConfig.signaturePrefix || "");
        setSignedPayload(source.manualConfig.signedPayload || "body"); setTimestampHeader(source.manualConfig.timestampHeader || "");
        setTimestampFormat(source.manualConfig.timestampFormat || "{timestamp}.{body}");
      }
      setStep(Math.min(5, Math.max(1, source.setupStep)));
    }).catch(cause => { if (active) setFailure((cause as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function goTo(next: number) {
    if (sourceId && next > 0 && next < 6) await api(`/api/sources/${sourceId}`, { setupStep: next }, "PATCH");
    setFailure(""); setStep(next);
  }
  async function proceed(work: () => Promise<void>, next: number) {
    setBusy(true); setFailure("");
    try { await work(); await goTo(next); } catch (cause) { setFailure((cause as Error).message); } finally { setBusy(false); }
  }
  async function choose(item: Provider) {
    if (sourceId && provider?.name !== item.name) {
      await api(`/api/sources/${sourceId}`, { provider: item.name, setupStep: 1 }, "PATCH");
      setHasSecret(false); setSecret(""); setHasVerificationToken(false); setVerificationToken("");
    }
    setProvider(item); await goTo(1);
  }
  async function cancelSetup() {
    if (!sourceId || !(await confirm({ title: `Cancel setup for ${name}?`, description: "This permanently deletes the draft source and any events it received. Remove its webhook from the provider separately if you already created one.", label: "Delete draft" }))) return;
    setBusy(true); setFailure("");
    try { await api(`/api/sources/${sourceId}`, {}, "DELETE"); window.location.assign(`/applications/${applicationId}#sources`); }
    catch (cause) { setFailure((cause as Error).message); setBusy(false); }
  }
  return <Shell><a className="back" href={`/applications/${applicationId}#sources`}><ArrowLeft size={14} /> Webhook Sources</a><div className="page-head"><div><div className="eyebrow">SETUP WIZARD</div><h1>Connect a webhook provider</h1><p className="muted">Receive signed events and forward them to your own backend with reliable delivery.</p></div>{sourceId && step < 6 && <button type="button" className="btn danger" disabled={busy} onClick={() => void cancelSetup()}><Trash2 size={15} />Cancel setup</button>}</div>
    <ol className="wizard-progress" aria-label="Setup progress">{titles.map((title, index) => <li key={title} aria-current={step === index ? "step" : undefined} className={index < step ? "complete" : ""}><span>{index < step ? "✓" : index + 1}</span>{title}</li>)}</ol><ErrorBox error={catalogError || failure} />
    {loading ? <div className="wizard-card">Loading setup draft…</div> : <>
    {step === 0 && <div className="wizard-card"><h2>Choose a provider</h2><p>Every listed provider has signature verification. Use Custom / Manual for another provider.</p><label className="wizard-search"><Search size={17} /><input aria-label="Search providers" placeholder="Search providers" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="provider-grid">{catalog?.filter(item => item.displayName.toLowerCase().includes(search.toLowerCase())).map(item => <button type="button" className={`provider-choice ${item.name === "CUSTOM" ? "manual" : ""}`} key={item.name} onClick={() => void choose(item).catch(cause => setFailure((cause as Error).message))}><ProviderIcon provider={item.name} /><strong>{item.displayName}</strong><small>Verified signatures</small></button>)}</div></div>}
    {step === 1 && provider && <form className="wizard-card" onSubmit={event => { event.preventDefault(); void proceed(async () => {
      if (sourceId) await api(`/api/sources/${sourceId}`, { name: name.trim() }, "PATCH");
      else { const created = await api<{id:string;ingestionUrl:string}>(`/api/applications/${applicationId}/sources`, { provider: provider.name, name: name.trim(), customerId }); setSourceId(created.id); setIngestionUrl(created.ingestionUrl); window.history.replaceState(null, "", `?source=${created.id}`); }
    }, 2); }}><h2>Name this source</h2><p>Use a label you will recognize in event logs, such as “{provider.displayName} — production.”</p><label>Source name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label>{sourceId ? <p className="muted">Customer assignment is fixed after this source is created.</p> : <CustomerSelect applicationId={applicationId} value={customerId} onChange={setCustomerId} />}<div className="wizard-actions"><button type="button" className="btn quiet" onClick={() => void goTo(0)}>Back</button><button className="btn" disabled={busy || (!sourceId && !customerId)}>Continue <ArrowRight size={16} /></button></div></form>}
    {step === 2 && provider && <div className="wizard-card"><h2>Get your {provider.displayName} ingestion URL</h2><p>This URL is unique to this source. Keep it private. Configure the provider after saving the signing secret and destination.</p><div className="secret-row"><code>{ingestionUrl}</code><CopyButton value={ingestionUrl} /></div><ol className="wizard-instructions">{provider.setupInstructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol><a href={provider.docsUrl} target="_blank" rel="noopener noreferrer">Open {provider.displayName} setup docs ↗</a>{provider.name === "GITHUB" && <p>Want automatic registration? Continue through the destination step, then enter a one time GitHub token on the test step.</p>}<div className="wizard-actions"><button type="button" className="btn quiet" onClick={() => void goTo(1)}>Back</button><button className="btn" onClick={() => void goTo(3)}>Continue <ArrowRight size={16} /></button></div></div>}
    {step === 3 && provider && <form className="wizard-card" onSubmit={event => { event.preventDefault(); void proceed(async () => {
      if (secret || verificationToken || provider.name === "CUSTOM") await api(`/api/sources/${sourceId}`, { ...(secret ? { providerSecret: secret } : {}), ...(verificationToken ? { verificationToken } : {}), ...(provider.name === "CUSTOM" ? { manualConfig: { signatureHeader, algorithm, encoding, signaturePrefix, signedPayload, ...(signedPayload === "timestamp-body" ? { timestampHeader, timestampFormat } : {}) } } : {}) }, "PATCH");
      setHasSecret(true); setSecret(""); if (verificationToken) setHasVerificationToken(true); setVerificationToken("");
    }, 4); }}><h2>Enter the provider signing secret</h2><p>Copy it from {provider.displayName}. Hooka Relay encrypts it and never shows it again.</p><label>Signing secret<input type="password" value={secret} onChange={event => setSecret(event.target.value)} autoComplete="off" required={!hasSecret} placeholder={hasSecret ? "Saved — leave blank to keep it" : ""} /></label>{["FACEBOOK", "INSTAGRAM", "WHATSAPP"].includes(provider.name) && <label>Meta Verify Token<input value={verificationToken} onChange={event => setVerificationToken(event.target.value)} required={!hasVerificationToken} minLength={8} maxLength={256} autoComplete="off" placeholder={hasVerificationToken ? "Saved — leave blank to keep it" : "Choose a token to enter in Meta's webhook settings"} /></label>}{provider.name === "GITHUB" && <p>You can skip this field and let Hooka Relay create and save a secret when it registers your GitHub webhook.</p>}{provider.name === "CUSTOM" && <div className="wizard-manual"><h3>Manual signature format</h3><label>Signature header<input placeholder="X-Webhook-Signature" value={signatureHeader} onChange={event => setSignatureHeader(event.target.value)} required /></label><label>Algorithm<select value={algorithm} onChange={event => setAlgorithm(event.target.value)}><option value="sha256">HMAC-SHA256</option><option value="sha1">HMAC-SHA1</option></select></label><label>Encoding<select value={encoding} onChange={event => setEncoding(event.target.value)}><option value="hex">Hex</option><option value="base64">Base64</option></select></label><label>Signature prefix, if any<input placeholder="sha256=" value={signaturePrefix} onChange={event => setSignaturePrefix(event.target.value)} /></label><label>Signed payload<select value={signedPayload} onChange={event => setSignedPayload(event.target.value)}><option value="body">Raw body only</option><option value="timestamp-body">Timestamp and raw body</option></select></label>{signedPayload === "timestamp-body" && <><label>Timestamp header<input value={timestampHeader} onChange={event => setTimestampHeader(event.target.value)} required /></label><label>Exact format<input value={timestampFormat} onChange={event => setTimestampFormat(event.target.value)} required /></label></>}</div>}<div className="wizard-actions"><button type="button" className="btn quiet" onClick={() => void goTo(2)}>Back</button><button className="btn" disabled={busy}>Save and continue <ArrowRight size={16} /></button>{provider.name === "GITHUB" && !hasSecret && <button type="button" className="btn secondary" onClick={() => void goTo(4)}>Set up automatically later</button>}</div></form>}
    {step === 4 && <form className="wizard-card" onSubmit={event => { event.preventDefault(); void proceed(async () => { await api(`/api/sources/${sourceId}`, { destinationUrl }, "PATCH"); }, 5); }}><h2>Where should verified events go?</h2><p>Enter your backend&apos;s public HTTPS URL for durable delivery, or use a local CLI listener while developing.</p><label>Destination URL<input type="url" placeholder="https://api.example.com/webhooks" value={destinationUrl} onChange={event => setDestinationUrl(event.target.value)} required /></label><div className="wizard-actions"><button type="button" className="btn quiet" onClick={() => void goTo(3)}>Back</button><button className="btn" disabled={busy}>Save and continue <ArrowRight size={16} /></button>{!destinationUrl && <button type="button" className="btn secondary" onClick={() => void goTo(5)}>Use a local listener only</button>}</div></form>}
    {step === 5 && provider && <TestStep sourceId={sourceId} provider={provider} hasDestination={!!destinationUrl} onBack={() => void goTo(4)} onDone={async () => { await api(`/api/sources/${sourceId}`, { status: "ACTIVE" }, "PATCH"); setStep(6); }} />}
    {step === 6 && <div className="wizard-card wizard-done"><CheckCircle2 size={36} /><h2>Source is active</h2><p>Verified webhooks are ready for {destinationUrl ? "your public destination" : "your local listener"}.</p><dl><dt>Ingestion URL</dt><dd><code>{ingestionUrl}</code></dd><dt>Destination</dt><dd>{destinationUrl || "Local listener only"}</dd></dl><div className="wizard-actions"><Link className="btn" href={`/sources/${sourceId}`}>View live event log</Link><a className="btn secondary" href={`/applications/${applicationId}#sources`}>Back to sources</a></div></div>}
    </>}
  </Shell>;
}
