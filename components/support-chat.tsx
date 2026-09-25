"use client";
import { T } from "@/components/preferences";
import { Bot, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
type Exchange = { question: string; answer: string };
const suggestions = ["How do I add a customer in Hooka Relay?", "How does Hooka Relay retry deliveries?", "How do I verify a Hooka Relay delivery?"];
export function SupportChat() {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(""), [history, setHistory] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [cached, setCached] = useState<boolean>();
  const messages = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { if (open) messages.current?.scrollTo({ top: history.length || busy ? messages.current.scrollHeight : 0 }); }, [open, history, busy]);
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
      <header><div className="support-heading"><span className="support-avatar"><Bot size={21} /></span><div><strong id="support-title">Hooka Relay assistant</strong><p className="muted"><T text="Answers from our documentation" /></p></div></div><div className="support-header-actions">{history.length > 0 && <button className="icon-button" type="button" onClick={() => { setHistory([]); setError(""); input.current?.focus(); }} title="Start a new conversation" aria-label="Start a new conversation"><RotateCcw size={16} /></button>}<button className="icon-button" type="button" onClick={close} aria-label="Close support assistant"><X size={18} /></button></div></header>
      <div ref={messages} className="support-messages" role="log" aria-live="polite">{!history.length && <div className="support-welcome"><span className="support-welcome-icon"><Bot size={26} /></span><h3><T text="What can I help with?" /></h3><p className="muted"><T text="Ask about setup, delivery, or security. I use Hooka Relay documentation and cannot see your workspace. Please keep keys and secrets out of chat." /></p><div className="support-suggestions" aria-label="Suggested questions">{suggestions.map(prompt => <button key={prompt} type="button" onClick={() => { setQuestion(prompt); input.current?.focus(); }}>{prompt}</button>)}</div></div>}{history.map((exchange, i) => <div className="support-exchange" key={i}><div className="chat-bubble user-bubble"><small><T text="You" /></small><p>{exchange.question}</p></div><div className="chat-bubble assistant-bubble"><small>Hooka Relay</small><p>{exchange.answer}</p></div></div>)}{busy && <div className="support-exchange"><div className="chat-bubble user-bubble"><small><T text="You" /></small><p>{question}</p></div><div className="chat-bubble assistant-bubble" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span><T text="Checking the documentation…" /></div></div>}</div>
      {error && <p role="alert" className="error">{error} <Link href="/docs" onClick={close}>Open docs</Link></p>}<form onSubmit={send}><label htmlFor="support-question"><T text="Your question" /></label><textarea ref={input} id="support-question" rows={2} maxLength={500} value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Ask about setup, retries, or signatures…" required /><div className="support-actions"><small className="muted">Enter to send · Shift+Enter for a new line</small><button className="btn" disabled={busy || !question.trim()} aria-label="Send question"><Send size={15} aria-hidden="true" /><T text={busy ? "Please wait…" : "Send"} /></button></div><div className="support-footer"><Link href="/docs" onClick={close}>Browse documentation</Link><small className="muted">{question.length}/500</small></div></form>
      {process.env.NODE_ENV === "development" && cached !== undefined && <small className="muted">{cached ? "Cache hit" : "Fresh response"}</small>}
    </section>
    <button ref={launcher} className="btn secondary support-launcher" hidden={open} onClick={() => setOpen(true)} aria-label="Hooka Relay support" aria-expanded={open} aria-controls="support-panel"><MessageCircle size={18} aria-hidden="true" /><span>Hooka Relay support</span></button>
  </aside>;
}
