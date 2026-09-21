export function chunkSupport(source: string, markdown: string) {
  // Small overlapping chunks stay below MiniLM's token window for ordinary
  // prose. Only explicitly selected repository documentation is ingested.
  const text = markdown.replace(/\r\n/g, "\n").trim();
  const chunks: { source: string; text: string }[] = [];
  for (let start = 0; start < text.length; start += 900) {
    chunks.push({ source, text: text.slice(start, start + 1100) });
    if (start + 1100 >= text.length) break;
  }
  return chunks;
}
