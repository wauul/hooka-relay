import { DELAYS } from "./queue/topology";
export type RetryPolicyName = "STANDARD" | "AGGRESSIVE" | "RELAXED";
const schedules = {
  STANDARD: [DELAYS[0], DELAYS[1], DELAYS[2], DELAYS[3]],
  AGGRESSIVE: [DELAYS[0], DELAYS[0], DELAYS[0], DELAYS[1], DELAYS[1], DELAYS[2]],
  RELAXED: [DELAYS[2], DELAYS[3], DELAYS[4]],
} as const;
export function retryPlan(policy: RetryPolicyName, attempt: number) {
  const configured = process.env[`RETRY_${policy}_QUEUES`];
  const schedule = configured ? configured.split(",").map(name => {
    const delay = DELAYS.find(d => d.name === name.trim());
    if (!delay) throw new Error("Retry schedule must reference existing TTL queues");
    return delay;
  }) : schedules[policy];
  if (!schedule.length || schedule.length > 10) throw new Error("Retry schedule must contain 1-10 intervals");
  return { exhausted: attempt > schedule.length, delay: schedule[Math.min(attempt - 1, schedule.length - 1)], maxAttempts: schedule.length + 1 };
}
