import amqp, { type ConfirmChannel, type ChannelModel } from 'amqplib';
import { declareTopology, EXCHANGE } from './topology';
let connection: ChannelModel | undefined;
let pending: Promise<ConfirmChannel> | undefined;
export function channel() {
  if (!pending) pending = (async () => {
    const conn = await amqp.connect(process.env.RABBITMQ_URL!, { timeout: 5000 });
    connection = conn;
    conn.on('error', () => { pending = undefined; });
    conn.on('close', () => { pending = undefined; });
    const ch = await conn.createConfirmChannel();
    ch.on('error', () => { pending = undefined; });
    await declareTopology(ch);
    return ch;
  })().catch(e => { pending = undefined; throw e; });
  return pending;
}
export async function publish(job: {id: string; attemptNumber: number}, delayQueue?: string | null) {
  const ch = await channel();
  await new Promise<void>((resolve, reject) => ch.publish(delayQueue ? '' : EXCHANGE, delayQueue || 'deliver', Buffer.from(JSON.stringify(job)), {persistent:true, contentType:'application/json'}, error => error ? reject(error) : resolve()));
}
export async function closeQueue() { await connection?.close(); pending = undefined; }
