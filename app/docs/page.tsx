"use client";
import { useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Clock3, KeyRound, Radio, RefreshCw, ShieldCheck, Terminal, Webhook } from "lucide-react";
import { Section, SectionNav, useSection } from "@/components/section-nav";
import { CodeBlock } from "@/components/ui";
import { Shell } from "@/components/shell";
import { faq } from "@/lib/site";
import { OutboundLink } from "@/components/site-tools";
import { ApiExplorer } from "@/components/api-explorer";

type Language = "node" | "python";

const examples = {
  send: {
    node: ['import { HookaRelay } from "hooka-relay-node";', 'const relay = new HookaRelay(process.env.HOOKA_API_KEY);', '', 'const event = await relay.sendEvent({', '  type: "order.shipped",', '  payload: { orderId: "ord_1042" },', '  idempotencyKey: "order-1042-shipped",', '});', 'console.log(event.id);'].join("\n"),
    python: ['import os', 'from hooka_relay import HookaRelay', '', 'relay = HookaRelay(os.environ["HOOKA_API_KEY"])', 'event = relay.send_event({', '    "type": "order.shipped",', '    "payload": {"orderId": "ord_1042"},', '    "idempotencyKey": "order-1042-shipped",', '})', 'print(event["id"])'].join("\n"),
  },
  verify: {
    node: ['import { verifyWebhook } from "hooka-relay-node";', '', '// rawBody is the exact request body, before JSON parsing.', 'const payload = verifyWebhook(rawBody, {', '  "webhook-id": request.headers["webhook-id"],', '  "webhook-timestamp": request.headers["webhook-timestamp"],', '  "webhook-signature": request.headers["webhook-signature"],', '}, process.env.HOOKA_SIGNING_SECRET);', '', '// Persist the verified webhook-id with your business change.', 'console.log(payload);'].join("\n"),
    python: ['import os', 'from hooka_relay import verify_webhook', '', '# raw_body is the exact request body, before JSON parsing.', 'payload = verify_webhook(raw_body, {', '    "webhook-id": headers["webhook-id"],', '    "webhook-timestamp": headers["webhook-timestamp"],', '    "webhook-signature": headers["webhook-signature"],', '}, os.environ["HOOKA_SIGNING_SECRET"])', '', '# Persist the verified webhook-id with your business change.', 'print(payload)'].join("\n"),
  },
  install: {
    node: 'npm install hooka-relay-node',
    python: 'pip install hooka-relay-python',
  },
};

function LanguageCode({ label, code, language, onLanguageChange }: { label: string; code: Record<Language, string>; language: Language; onLanguageChange: (language: Language) => void }) {
  return <div className="docs-example">
    <div className="docs-example-head"><strong>{label}</strong><div className="docs-language" role="group" aria-label={`${label} language`}>
      <button type="button" aria-pressed={language === "node"} onClick={() => onLanguageChange("node")}>Node.js</button>
      <button type="button" aria-pressed={language === "python"} onClick={() => onLanguageChange("python")}>Python</button>
    </div></div>
    <CodeBlock>{code[language]}</CodeBlock>
  </div>;
}

export default function Page() {
  const section = useSection(["send", "signatures", "retries", "sources", "api-reference", "tooling", "faq"]);
  const [language, setLanguage] = useState<Language>("node");
  return <Shell><article className="docs">
    <div className="docs-intro"><div className="eyebrow">DEVELOPER DOCUMENTATION</div><Link href="/status">View service status</Link></div>
    <h1>Your first webhook, delivered.</h1>
    <p className="docs-lead">Create an application, connect an HTTPS endpoint, then send an event. Hooka Relay stores it durably and delivers it in the background.</p>
    <SectionNav active={section} items={[{ id: "send", label: "Getting started" }, { id: "signatures", label: "Security" }, { id: "retries", label: "Delivery" }, { id: "sources", label: "Inbound sources" }, { id: "api-reference", label: "API reference" }, { id: "tooling", label: "CLI & SDKs" }, { id: "faq", label: "FAQ" }]} />

    <Section active={section} name="send">
      <div className="docs-section-head"><span className="docs-icon"><Webhook size={20} /></span><div><div className="eyebrow">GETTING STARTED</div><h2 id="send">Send your first event</h2><p>Copy the Application API key from your application page and keep it on your server.</p></div></div>
      <div className="docs-steps"><div><span>01</span><strong>Create an application</strong><p>It holds your key, endpoints, and event history.</p></div><div><span>02</span><strong>Add an HTTPS endpoint</strong><p>Subscribe it to <code>order.shipped</code> or <code>*</code>.</p></div><div><span>03</span><strong>Send an event</strong><p>The API accepts it with <code>202 Accepted</code>; delivery runs asynchronously.</p></div></div>
      <LanguageCode label="Send an event" code={examples.send} language={language} onLanguageChange={setLanguage} />
      <div className="docs-callout"><CheckCircle2 size={19} /><p>Use the same <code>idempotencyKey</code> when retrying an uncertain send. A repeated key returns the original event, even if the new payload differs.</p></div>
      <p>Payloads can be up to 256 KB. An endpoint receives an event when it subscribes to the event&apos;s exact type or <code>*</code>.</p>
    </Section>

    <Section active={section} name="signatures">
      <div className="docs-section-head"><span className="docs-icon"><ShieldCheck size={20} /></span><div><div className="eyebrow">SECURITY</div><h2 id="signatures">Trust the webhook before processing it</h2><p>Every new endpoint uses Standard Webhooks and has its own <code>whsec_</code> signing secret.</p></div></div>
      <div className="docs-flow" aria-label="Webhook verification steps"><div><span>1</span><strong>Receive raw bytes</strong><p>Keep the body exactly as sent. Parsing and serializing it again changes the signed bytes.</p></div><div><span>2</span><strong>Verify the signature</strong><p>Use the SDK and the endpoint secret to check the ID, timestamp, and body.</p></div><div><span>3</span><strong>Record the event ID</strong><p>Save the verified <code>webhook-id</code> with your business change so a retry has no second effect.</p></div></div>
      <LanguageCode label="Verify a delivery" code={examples.verify} language={language} onLanguageChange={setLanguage} />
      <div className="docs-note-grid"><div className="docs-note"><KeyRound size={19} /><h3>Which key goes where?</h3><p>Your Application API key sends events. An endpoint&apos;s signing secret verifies deliveries. Keep both on the server.</p></div><div className="docs-note"><Clock3 size={19} /><h3>Rotation and time</h3><p>During rotation, either signing key verifies for seven days by default. Verification rejects timestamps outside five minutes.</p></div></div>
    </Section>

    <Section active={section} name="retries">
      <div className="docs-section-head"><span className="docs-icon"><RefreshCw size={20} /></span><div><div className="eyebrow">DELIVERY</div><h2 id="retries">When a receiver does not respond</h2><p>Return any 2xx response after accepting a verified event. A timeout or non-2xx response schedules another attempt.</p></div></div>
      <div className="docs-timeline" aria-label="Standard retry schedule"><div><strong>1</strong><span>Now</span><small>First attempt</small></div><div><strong>2</strong><span>+30 seconds</span><small>First retry</small></div><div><strong>3</strong><span>+2 minutes</span><small>Second retry</small></div><div><strong>4</strong><span>+5 minutes</span><small>Third retry</small></div><div><strong>5</strong><span>+15 minutes</span><small>Final attempt</small></div></div>
      <p className="docs-caption">Standard policy has five total HTTP attempts. Each request has a 10-second deadline. After the final failure, the delivery becomes <code>DEAD_LETTERED</code>.</p>
      <div className="docs-policy-grid"><div className="docs-policy"><span>STANDARD · DEFAULT</span><strong>5 attempts</strong><p>30s · 2m · 5m · 15m</p></div><div className="docs-policy"><span>AGGRESSIVE</span><strong>7 attempts</strong><p>30s · 30s · 30s · 2m · 2m · 5m</p></div><div className="docs-policy"><span>RELAXED</span><strong>4 attempts</strong><p>5m · 15m · 30m</p></div></div>
      <h3 className="docs-subhead">What the circuit breaker does</h3>
      <div className="docs-state-grid"><div><Radio size={18} /><strong>Closed</strong><p>Normal delivery. Five consecutive endpoint failures open the circuit.</p></div><div><Clock3 size={18} /><strong>Open</strong><p>Requests are skipped without using an HTTP attempt. The endpoint cools down for ten minutes.</p></div><div><CheckCircle2 size={18} /><strong>Half-open</strong><p>One probe tests recovery. Success closes the circuit; failure restarts the cooldown.</p></div></div>
      <div className="docs-callout"><RefreshCw size={19} /><p>For example, if your server is down after accepting an event, a retry can arrive later. Keep handlers idempotent. Delivery order is not guaranteed across retries or replays.</p></div>
      <div className="docs-note-grid"><div className="docs-note"><Radio size={19} /><h3>Try a demo receiver</h3><p>When adding an endpoint, choose <code>succeed</code>, <code>fail</code>, <code>hang</code>, or <code>flaky</code> to see how delivery responds.</p></div><div className="docs-note"><RefreshCw size={19} /><h3>Diagnose and recover</h3><p>Inspect endpoint attempts and advisory failure diagnosis. After a fix, send a synthetic test or replay an exhausted event.</p></div></div>
    </Section>

    <Section active={section} name="sources">
      <div className="docs-section-head"><span className="docs-icon"><Webhook size={20} /></span><div><div className="eyebrow">INBOUND WEBHOOKS</div><h2>Connect an external provider</h2><p>Open an application&apos;s Webhook Sources tab to start the Setup Wizard.</p></div></div>
      <div className="docs-steps"><div><span>01</span><strong>Choose a source</strong><p>Select a provider from payments, commerce, messaging, forms, support, or social platforms.</p></div><div><span>02</span><strong>Verify the sender</strong><p>Enter its signing secret and configure the ingestion URL. GitHub repository hooks can be registered from the wizard.</p></div><div><span>03</span><strong>Choose where events go</strong><p>Add a public destination, listen on your local machine, or use both. You can leave setup and resume later.</p></div></div>
      <p>Hooka Relay requires a valid provider signature before accepting an inbound event. The destination receives a Hooka Relay signed JSON payload with <code>provider</code>, <code>sourceId</code>, <code>providerEventId</code>, and <code>data</code>. Retries, circuit protection, idempotency, and delivery logs use the same engine as normal outbound events.</p>
      <div className="docs-callout"><ShieldCheck size={19} /><p>Each listed provider has a signature verifier. Meta callbacks also answer the Verify Token challenge, and Zoom answers URL validation. Custom supports configurable HMAC-SHA256 or HMAC-SHA1. PayPal requires a separate certificate or verification API flow and is not available yet.</p></div>
      <p>A source URL is a private token. Its provider secret is encrypted. Failed signature checks appear in the source dashboard with a generic public rejection. Inbound bodies are limited to 256 KB and JSON depth 32, with the existing event quotas.</p>
      <p>For a provider test, trigger a real signed event in its dashboard. Twilio and Custom offer an explicitly labeled simulation that tests the forwarding path, without claiming to verify the provider.</p>
      <h3 className="docs-subhead">Listen locally and inspect requests</h3>
      <p>Run <code>hooka listen --source SOURCE_ID --forward-to http://localhost:3000/webhooks</code>. The worker forwards each verified request to the CLI over an authenticated live connection. Your local server receives the original body bytes and provider signature header. The source page shows when a listener is connected.</p>
      <p>The source event log retains received requests even while no listener is online. Filter by date, verification result, or body text; open a request to inspect headers, body, delivery attempts, and replay history. A manual replay forwards the saved original bytes to the current public destination and connected local listeners. Only authenticated workspace users can inspect verification failures; the provider still receives a generic rejection.</p>
    </Section>

    <Section active={section} name="api-reference">
      <div className="docs-section-head"><span className="docs-icon"><BookOpen size={20} /></span><div><div className="eyebrow">API REFERENCE</div><h2>Explore the HTTP API</h2><p>Use your Application API key for ingestion; dashboard routes use your signed-in session.</p></div></div>
      <div className="docs-route-list"><div><code>POST /api/v1/events</code><span>Accept a new event</span></div><div><code>POST /api/inbound/:ingestionToken</code><span>Accept a signed provider webhook</span></div><div><code>GET /api/v1/applications/:id/events</code><span>Read an event backlog</span></div><div><code>GET /api/endpoints/:id/attempts</code><span>Inspect delivery attempts</span></div><div><code>POST /api/events/:id/replay</code><span>Replay an event</span></div></div>
      <div className="docs-callout"><KeyRound size={19} /><p>Use the interactive explorer with a test application key. “Try it out” sends real requests to this deployment. Authorization stays in this page&apos;s memory and clears on reload.</p></div>
      <p>Endpoint registration accepts public HTTPS URLs. Private addresses, redirects, and embedded credentials are rejected.</p>
      {section === "api-reference" && <ApiExplorer />}
    </Section>

    <Section active={section} name="tooling">
      <div className="docs-section-head"><span className="docs-icon"><Terminal size={20} /></span><div><div className="eyebrow">CLI & SDKs</div><h2>Build with the tools you prefer</h2><p>Use a server SDK in your application, or work from the terminal with the CLI.</p></div></div>
      <h3 className="docs-subhead">Node.js and Python SDKs</h3>
      <p>The SDKs send events and verify Standard Webhooks. They make one request per send, with no automatic retries; reuse an explicit idempotency key if a network result is uncertain.</p>
      <LanguageCode label="Install the SDK" code={examples.install} language={language} onLanguageChange={setLanguage} />
      <div className="docs-link-row"><OutboundLink href="https://www.npmjs.com/package/hooka-relay-node" target="_blank">Node.js package ↗</OutboundLink><OutboundLink href="https://pypi.org/project/hooka-relay-python/" target="_blank">Python package ↗</OutboundLink></div>
      <h3 className="docs-subhead">Command-line companion</h3>
      <p>Install <code>hooka-relay-cli</code>, then authenticate with an Application API key. The CLI can send, tail, inspect endpoints, replay deliveries, and forward inbound requests to localhost.</p>
      <CodeBlock>{'npm install -g hooka-relay-cli\nhooka login\nhooka send --type order.shipped --payload-file payload.json\nhooka tail\nhooka replay EVENT_ID\nhooka listen --source SOURCE_ID --forward-to http://localhost:3000/webhooks'}</CodeBlock>
      <div className="docs-callout"><Terminal size={19} /><p><code>hooka login</code> saves your key locally. Run <code>hooka logout</code> to remove it. An ingest-only key can send with <code>--no-wait</code>; inspection and replay require broader key access.</p></div>
      <div className="docs-link-row"><OutboundLink href="https://www.npmjs.com/package/hooka-relay-cli" target="_blank">CLI package ↗</OutboundLink><OutboundLink href="https://github.com/wauul/hooka-cli" target="_blank">CLI command reference ↗</OutboundLink></div>
    </Section>

    <Section active={section} name="faq"><section className="faq-section" aria-labelledby="faq"><div className="eyebrow">GOOD QUESTIONS. CLEAR ANSWERS.</div><h2 id="faq">Frequently asked questions</h2>{faq.map((item, i) => <details className="faq-item" id={`faq-${i}`} key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</section></Section>
  </article></Shell>;
}
