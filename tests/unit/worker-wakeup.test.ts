import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ channel: vi.fn(), assertExchange: vi.fn(), publish: vi.fn() }));
vi.mock("../../lib/queue/client", () => ({ channel: mocks.channel }));
import { wakeWorker, WORKER_WAKE_EXCHANGE } from "../../lib/worker-wakeup";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.channel.mockResolvedValue({ assertExchange: mocks.assertExchange, publish: mocks.publish });
  mocks.assertExchange.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

it("broadcasts a transient hint for every connected worker after a commit", async () => {
  mocks.publish.mockImplementation((_exchange, _key, _body, _options, confirm) => confirm(null));
  await wakeWorker();
  expect(mocks.assertExchange).toHaveBeenCalledWith(WORKER_WAKE_EXCHANGE, "fanout", { durable: true });
  expect(mocks.publish.mock.calls[0].slice(0, 2)).toEqual([WORKER_WAKE_EXCHANGE, ""]);
  expect(mocks.publish.mock.calls[0][3]).toEqual({ persistent: false });
});

it("does not turn committed work into an API error when RabbitMQ is unavailable", async () => {
  mocks.channel.mockRejectedValue(new Error("offline"));
  await expect(wakeWorker()).resolves.toBeUndefined();
});

it("bounds confirmation waiting when the broker never responds", async () => {
  vi.useFakeTimers();
  const sent = wakeWorker();
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(sent).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up the timeout after a synchronous publish failure", async () => {
  vi.useFakeTimers();
  mocks.publish.mockImplementation(() => { throw new Error("closed"); });
  await expect(wakeWorker()).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
