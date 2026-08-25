import { describe, expect, it } from "vitest";

import { getExecutionDisclosureLabel } from "@/lib/ui/execution-disclosure";

describe("getExecutionDisclosureLabel", () => {
  it("流式检索阶段应显示正在检索资料", () => {
    expect(
      getExecutionDisclosureLabel({
        hasText: false,
        progressData: { phase: "retrieving", completedSteps: [] },
      }),
    ).toBe("正在检索资料");
  });

  it("正文开始输出后应显示已完成思考", () => {
    expect(
      getExecutionDisclosureLabel({
        hasText: true,
        progressData: { phase: "answering", completedSteps: [] },
      }),
    ).toBe("已完成思考");
  });
});
