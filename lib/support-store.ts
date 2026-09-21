import { randomUUID } from "node:crypto";
import { db } from "./db";
import { embedSupport } from "./support-embeddings";
import { answerSupport } from "./support-gate";
import { classifySupport, generateSupport } from "./support-model";
import { admitSupport } from "./support-quota";
export async function supportAnswer(req: Request, raw: unknown, userId?: string) {
  const id = randomUUID();
  const corpus = await db.supportCorpus.findUnique({ where: { id: 1 } });
  if (!corpus) throw new Error("Support documentation is not configured");
  const result = await answerSupport(raw, {
    revision: corpus.revision,
    admit: () => admitSupport(req, userId), classify: classifySupport,
    logClassification: async decision => { await db.supportDecision.create({ data: { id, ...decision } }); },
    cacheGet: async key => (await db.supportAnswerCache.findFirst({ where: { key, expiresAt: { gt: new Date() } } }))?.answer ?? null,
    cachePut: async (key, answer) => {
      // Bound storage under the global admission cap; no questions or histories
      // are stored in the cache, only their digest and the public-doc answer.
      await db.supportAnswerCache.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      const expiresAt = new Date(Date.now() + 86400000);
      await db.supportAnswerCache.upsert({ where: { key }, create: { key, answer, expiresAt }, update: { answer, expiresAt } });
    },
    retrieve: async question => {
      const vector = JSON.stringify(await embedSupport(question));
      return db.$queryRaw<{ source: string; text: string }[]>`
        SELECT source, text FROM "SupportDocument"
        WHERE revision = ${corpus.revision} AND embedding <=> ${vector}::vector < 0.7
        ORDER BY embedding <=> ${vector}::vector LIMIT 4`;
    },
    generate: generateSupport,
  });
  await db.supportDecision.update({ where: { id }, data: { cacheHit: result.cacheHit, completed: true } });
  await db.supportDecision.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
  return result;
}
