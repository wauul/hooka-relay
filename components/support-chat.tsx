"use client";
import { useState } from "react";
type Exchange = { question: string; answer: string };
export function SupportChat() {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(""), [history, setHistory] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [cached, setCached] = useState<boolean>();
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (busy || !question.trim()) return;
    const text = question.trim(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/support-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history: history.slice(-3).map(e => ({ ...e, answer: e.answer.slice(0, 3000) })) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Support unavailable");
      setHistory(previous => [...previous.slice(-9), { question: text, answer: result.answer }]); setQuestion(""); setCached(result.cacheHit);
    } catch (e) { setError(e instanceof Error ? e.message : "Support unavailable"); } finally { setBusy(false); }
  }
  return <aside className="support-widget" aria-label="Hooka Relay Support Assistant">
    {open && <section className="support-panel"><header><div><strong>Hooka Relay Support Assistant</strong><p className="muted">Features, setup, and troubleshooting.</p></div><button className="btn secondary" onClick={() => setOpen(false)} aria-label="Close support assistant">×</button></header>
      <div className="support-messages" role="log" aria-live="polite">{!history.length && <p className="muted">Ask about Hooka Relay. Answers use our documentation and cannot inspect or change your workspace. Don’t share secrets or API keys.</p>}{history.map((exchange, i) => <div key={i}><p><strong>You</strong><br />{exchange.question}</p><p className="support-answer"><strong>Support</strong><br />{exchange.answer}</p></div>)}{busy && <p className="muted">Checking the documentation…</p>}</div>
      {error && <p role="alert">{error}</p>}<form onSubmit={send}><label htmlFor="support-question">Your question</label><textarea id="support-question" rows={3} maxLength={500} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Why is my Hooka Relay endpoint circuit open?" required /><div className="support-actions"><small className="muted">{question.length}/500</small><button className="btn primary" disabled={busy || !question.trim()}>{busy ? "Please wait…" : "Ask support"}</button></div></form>
      {process.env.NODE_ENV === "development" && cached !== undefined && <small className="muted">{cached ? "Cache hit" : "Fresh response"}</small>}
    </section>}
    {!open && <button className="btn secondary" onClick={() => setOpen(true)} aria-expanded={false}>Hooka Relay support</button>}
  </aside>;
}
