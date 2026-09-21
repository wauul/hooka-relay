import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { embedSupport } from "../lib/support-embeddings";
import { chunkSupport } from "../lib/support-corpus";
async function main() {
  const sources = ["README.md", "SECURITY.md", "docs/faq.md", "docs/api.md"];
  const chunks = (await Promise.all(sources.map(async source => chunkSupport(source, await readFile(source, "utf8"))))).flat();
  const revision = createHash("sha256").update(JSON.stringify(chunks)).digest("hex");
  const existing = await db.supportCorpus.findUnique({ where: { id: 1 } });
  if (existing?.revision === revision) { console.log("Support corpus unchanged"); return; }
  // Embed serially before publishing. A failed download/inference leaves the
  // previous corpus active; credentials and application data are never ingested.
  const vectors: string[] = [];
  for (const chunk of chunks) vectors.push(JSON.stringify(await embedSupport(chunk.text)));
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72707370)`;
    await tx.supportDocument.deleteMany();
    for (let i = 0; i < chunks.length; i++) await tx.$executeRaw`INSERT INTO "SupportDocument" (id, source, text, revision, embedding) VALUES (${randomUUID()}, ${chunks[i].source}, ${chunks[i].text}, ${revision}, ${vectors[i]}::vector)`;
    await tx.supportCorpus.upsert({ where: { id: 1 }, create: { id: 1, revision }, update: { revision } });
    await tx.supportAnswerCache.deleteMany();
  }, { timeout: 60000 });
  console.log(`Published ${chunks.length} documentation chunks`);
}
main().finally(() => db.$disconnect());
