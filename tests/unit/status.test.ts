import { expect, it } from "vitest";
import { summarizeStatus, type StatusBucket } from "../../lib/status-summary";
const now = new Date("2026-09-21T12:00:00Z");
const b = (minute: number, success = 4, total = 10): StatusBucket => ({ at: new Date(now.getTime() + minute * 60000).toISOString(), success, total });
it("does not label absent data as 100% healthy", () => { const s=summarizeStatus([],now); expect(s.successRate).toBeNull(); expect(s.degraded).toBe(false); });
it("requires two contiguous completed windows and detects ongoing incidents", () => { expect(summarizeStatus([b(-5)],now).incidents).toEqual([]); const s=summarizeStatus([b(-10),b(-5)],now); expect(s.degraded).toBe(true); expect(s.incidents[0].end).toBeNull(); expect(s.successRate).toBe(40); });
it("does not count partial, sparse or low-sample windows as sustained failure", () => { for(const rows of [[b(-5),b(0)],[b(-15),b(-5)],[b(-10),b(-5,0,1)]]) expect(summarizeStatus(rows,now).degraded).toBe(false); });
it("closes incidents on recovery and on missing observations", () => { const s=summarizeStatus([b(-15),b(-10),b(-5,9)],now); expect(s.incidents).toHaveLength(1); expect(s.incidents[0].end).toBe(b(-5).at); expect(s.degraded).toBe(false); expect(summarizeStatus([b(-20),b(-15)],now).degraded).toBe(false); });
