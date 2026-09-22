import { createElement as h } from "react";
import { render, toPlainText } from "@react-email/render";
export type TransactionalMessage = { to: string; subject: string; title: string; body: string; action: string; url: string; footer?: string; id: string };
export async function emailContent(message: TransactionalMessage) {
  const html = await render(h("html", { lang: "en" }, h("body", { style: { margin: 0, padding: "32px 16px", backgroundColor: "#0d1015", color: "#edf0f4", fontFamily: "Arial, sans-serif" } },
    h("table", { role: "presentation", width: "100%", cellPadding: 0, cellSpacing: 0, style: { maxWidth: 560, margin: "0 auto", backgroundColor: "#14181f", borderRadius: 16 } }, h("tbody", null, h("tr", null, h("td", { style: { padding: 32 } },
      h("p", { style: { fontSize: 20, fontWeight: 700, margin: "0 0 32px" } }, "hooka relay", h("span", { style: { color: "#adf7b6" } }, " •")),
      h("h1", { style: { fontSize: 26, lineHeight: 1.25, marginBottom: 20 } }, message.title),
      h("p", { style: { fontSize: 16, lineHeight: 1.7, whiteSpace: "pre-line" } }, message.body),
      h("a", { href: message.url, style: { display: "inline-block", backgroundColor: "#adf7b6", color: "#0d1015", padding: "15px 24px", borderRadius: 8, fontWeight: 700, textDecoration: "none", margin: "16px 0 24px" } }, message.action),
      h("p", { style: { fontSize: 12, lineHeight: 1.7, color: "#939dab" } }, message.footer || "This is a transactional message from Hooka Relay. If you did not request it, you can ignore it."),
      h("p", { style: { fontSize: 12, lineHeight: 1.6, color: "#939dab", overflowWrap: "anywhere" } }, "If the button does not work, copy this link: ", message.url)
    ))))
  )));
  return { html, text: toPlainText(html) };
}
export async function sendTransactionalEmail(message: TransactionalMessage) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM || !process.env.NEXTAUTH_URL) throw new Error("Email configuration missing");
  const content = await emailContent(message);
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.id }, body: JSON.stringify({ from: process.env.RESEND_FROM, to: [message.to], subject: message.subject, ...content, ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}) }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Email send failed");
}
