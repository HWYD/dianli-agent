import { describe, expect, it } from "vitest";

import { getRemainingDeadlineMs } from "@/lib/agent/deadline";

describe("请求总时限", () => {
  it("根据统一截止时间计算剩余时间，且不返回负数", () => {
    expect(getRemainingDeadlineMs(120_000, 30_000)).toBe(90_000);
    expect(getRemainingDeadlineMs(120_000, 120_000)).toBe(0);
    expect(getRemainingDeadlineMs(120_000, 150_000)).toBe(0);
  });
});
