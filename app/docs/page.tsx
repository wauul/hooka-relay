import { CodeBlock } from "@/components/ui";
import { Shell } from "@/components/shell";
import { faq } from "@/lib/site";
import { OutboundLink } from "@/components/site-tools";
export default function Page() {
  return (
    <Shell>
      <article className="docs">
        <div className="eyebrow">DEVELOPER DOCUMENTATION</div>
        <h1 style={{ fontSize: 34, letterSpacing: -1 }}>
          Your first webhook, delivered.
        </h1>
        <p>
          Create an application, register an HTTPS endpoint, then send an event.
          Hooka Relay stores it durably and delivers matching events
          asynchronously.
        </p>
        <h2 id="send">1. Send an event</h2>
        <CodeBlock>{`curl -X POST "$RELAY_URL/api/v1/events" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"type":"order.shipped","idempotencyKey":"order-1042-shipped",\n       "payload":{"orderId":"ord_1042"}}'`}</CodeBlock>
        <p>
          A successful request returns <code>202 Accepted</code> with the stored
          event. The payload limit is 256 KB. Events match endpoints subscribed
          to their exact type or <code>*</code>. Delivery never blocks on a
          receiver.
        </p>
        <h2 id="signatures">2. Verify the signature</h2>
        <p>
          Every POST contains the event payload as its JSON body. Verify{" "}
          <code>X-Webhook-Signature</code> against the exact raw bytes using the
          endpoint’s signing secret. The header signs the timestamp, a period, and the raw body. Reject timestamps outside five minutes and keep your receiver clock synchronized.
        </p>
        <CodeBlock>{`import { createHmac, timingSafeEqual } from 'node:crypto';\n\nexport function verifyWebhook(rawBody, signature, secret) {\n  const parts = /^t=(\\d{1,12}),v1=([a-f0-9]{64})$/.exec(signature || '');\n  if (!parts || Math.abs(Date.now() / 1000 - Number(parts[1])) > 300) return false;\n  const expected = createHmac('sha256', secret)\n    .update(parts[1] + '.').update(rawBody).digest();\n  return timingSafeEqual(Buffer.from(parts[2], 'hex'), expected);\n}`}</CodeBlock>
        <p>
          Reject invalid signatures before processing. Do not parse and
          reserialize JSON before verification, because whitespace or field
          order can change the signed bytes.
        </p>
        <h2 id="idempotency">3. Make receivers idempotent</h2>
        <p>
          Supply an <code>idempotencyKey</code> to prevent duplicate producer
          submissions within an application. Omit it to generate a UUID. A
          repeated key returns the original event, even when the new payload
          differs.
        </p>
        <p>
          At-least-once delivery means a receiver can see an event more than
          once—for example, if it processes a request but the acknowledgement is
          lost. Atomically store the <code>X-Idempotency-Key</code> with your
          business changes. Return 2xx for an already processed event. Replays
          preserve the original key.
        </p>
        <h2 id="retries">Retries & circuit breaking</h2>
        <p>
          Each delivery has at most five HTTP attempts: immediately, then after
          30 seconds, 2 minutes, 5 minutes, and 15 minutes. Each request has a
          10-second deadline. A final failure becomes DEAD_LETTERED. A 30-minute
          delay queue is also declared for future policies.
        </p>
        <ul>
          <li>
            <strong>CLOSED:</strong> Normal delivery. Five consecutive endpoint
            failures open the circuit.
          </li>
          <li>
            <strong>OPEN:</strong> Requests are skipped and logged without
            spending the HTTP retry budget.
          </li>
          <li>
            <strong>HALF_OPEN:</strong> After ten minutes, one recovery probe
            runs. Success closes the circuit; failure restarts the cooldown.
          </li>
        </ul>
        <p>
          Delayed messages use standard RabbitMQ TTL and dead-letter exchanges,
          compatible with CloudAMQP’s shared free plan. A database outbox
          recovers interrupted publishing and overdue deliveries.
        </p>
        <h2 id="receivers">Demo receivers</h2>
        <p>
          Use “Add endpoint” to register <code>succeed</code>, <code>fail</code>
          , <code>hang</code>, or <code>flaky</code>. Flaky fails twice for each
          endpoint/event key, then succeeds. Hang waits longer than the worker
          deadline; the hosting platform eventually terminates it.
        </p>
        <h2 id="diagnosis">Failure diagnosis</h2>
        <p>
          After three consecutive failures, Groq analyzes recent status codes
          and truncated response bodies. These responses are sent to Groq; avoid
          sensitive information in receiver error bodies. Diagnosis is advisory
          and never blocks future delivery if unavailable.
        </p>
        <h2 id="api-reference">API reference</h2>
        <CodeBlock>{`POST /api/v1/events                     API-key authentication\nGET/POST /api/applications/:id/endpoints Session authentication\nGET /api/endpoints/:id/attempts          Session authentication\nPOST /api/events/:id/replay              Session authentication\nGET/POST /api/fake-receiver/:mode        Public demo receiver`}</CodeBlock>
        <p>
          Endpoint registration accepts{" "}
          <code>
            {'{"url":"https://example.com/webhook","eventTypes":["*"]}'}
          </code>
          . Dashboard routes enforce application ownership. Private IP ranges,
          redirects, embedded credentials, and non-HTTPS destinations are
          blocked.
        </p>
        <h2 id="cli">Command-line companion</h2>
        <p>Send, tail and replay events without leaving your terminal.</p>
        <CodeBlock>
          {"npm install -g hooka-relay-cli\nhooka login\nhooka tail"}
        </CodeBlock>
        <OutboundLink
          className="btn secondary"
          href="https://www.npmjs.com/package/hooka-relay-cli"
          target="_blank"
        >
          Explore the CLI ↗
        </OutboundLink>
        <section className="faq-section" aria-labelledby="faq">
          <div className="eyebrow">GOOD QUESTIONS. CLEAR ANSWERS.</div>
          <h2 id="faq">Frequently asked questions</h2>
          {faq.map((item, i) => (
            <details className="faq-item" id={`faq-${i}`} key={item.question}>
              <summary>
                {item.question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
      </article>
    </Shell>
  );
}
