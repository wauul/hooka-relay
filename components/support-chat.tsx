"use client";
import { T } from "@/components/preferences";
import { Bot, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
type Exchange = { question: string; answer: string };
export function SupportChat() {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(""), [history, setHistory] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [cached, setCached] = useState<boolean>();
  const messages = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) { input.current?.focus(); messages.current?.scrollTo({ top: messages.current.scrollHeight }); } }, [open]);
  useEffect(() => { messages.current?.scrollTo({ top: messages.current.scrollHeight }); }, [history, busy]);
  function close() { setOpen(false); requestAnimationFrame(() => launcher.current?.focus()); }
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
    <section className={`support-panel ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open} id="support-panel" role="dialog" aria-labelledby="support-title" onKeyDown={event => { if(event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <header><div className="support-heading"><span className="support-avatar"><Bot size={21} /></span><div><strong id="support-title">Hooka Relay Support Assistant</strong><p className="muted"><T text="Features, setup, and troubleshooting." /></p></div></div><button className="icon-button" type="button" onClick={close} aria-label="Close support assistant"><X size={18} /></button></header>
      <div ref={messages} className="support-messages" role="log" aria-live="polite">{!history.length && <div className="support-welcome"><Bot size={28} /><h3><T text="How can we help?" /></h3><p className="muted"><T text="Ask about Hooka Relay. Answers use our documentation and cannot inspect or change your workspace. Don’t share secrets or API keys." /></p></div>}{history.map((exchange, i) => <div className="support-exchange" key={i}><div className="chat-bubble user-bubble"><small><T text="You" /></small><p>{exchange.question}</p></div><div className="chat-bubble assistant-bubble"><small>Hooka Relay</small><p>{exchange.answer}</p></div></div>)}{busy && <div className="support-exchange"><div className="chat-bubble user-bubble"><small><T text="You" /></small><p>{question}</p></div><div className="chat-bubble assistant-bubble" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span><T text="Checking the documentation…" /></div></div>}</div>
      {error && <p role="alert" className="error">{error}</p>}<form onSubmit={send}><label htmlFor="support-question"><T text="Your question" /></label><textarea ref={input} id="support-question" rows={2} maxLength={500} value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} placeholder="Why is my Hooka Relay endpoint circuit open?" required /><div className="support-actions"><small className="muted">{question.length}/500</small><button className="btn" disabled={busy || !question.trim()}><Send size={15} aria-hidden="true" /><T text={busy ? "Please wait…" : "Ask support"} /></button></div></form>
      {process.env.NODE_ENV === "development" && cached !== undefined && <small className="muted">{cached ? "Cache hit" : "Fresh response"}</small>}
    </section>
    <button ref={launcher} className="btn secondary support-launcher" hidden={open} onClick={() => setOpen(true)} aria-label="Hooka Relay support" aria-expanded={open} aria-controls="support-panel"><MessageCircle size={18} aria-hidden="true" /><span>Hooka Relay support</span></button>
  </aside>;
}
