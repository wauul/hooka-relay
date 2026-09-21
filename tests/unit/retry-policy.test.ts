import { expect, it } from "vitest";
import { retryPlan, type RetryPolicyName } from "../../lib/retry-policy";
import { DELAYS } from "../../lib/queue/topology";
it.each([
  ["STANDARD", [30000,120000,300000,900000]],
  ["AGGRESSIVE", [30000,30000,30000,120000,120000,300000]],
  ["RELAXED", [300000,900000,1800000]],
] as [RetryPolicyName, number[]][])("uses existing TTL queues and exhausts the %s budget", (policy, delays) => {
  for(let i=0;i<delays.length;i++){ const plan=retryPlan(policy,i+1); expect(plan.exhausted).toBe(false); expect(plan.delay.ms).toBe(delays[i]); expect(DELAYS).toContain(plan.delay); }
  expect(retryPlan(policy,delays.length+1).exhausted).toBe(true); expect(retryPlan(policy,100).exhausted).toBe(true);
});
it("a shortened policy finishes over-budget deliveries without scheduling another retry",()=>expect(retryPlan("RELAXED",5).exhausted).toBe(true));
