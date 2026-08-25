import { describe, expect, it } from "vitest";

import { getRequestExecutionState } from "@/lib/ui/execution-state";

describe("聊天执行状态", () => {
  it("在流已创建空 assistant 消息但正文尚未到达时继续显示思考中", () => {
    expect(
      getRequestExecutionState({
        isRunning: true,
        lastMessageRole: "assistant",
        hasVisibleAssistantContent: false,
        hasError: false,
      }),
    ).toBe("thinking");
  });

  it("在正文流中断后即使最后一条是 assistant 消息也显示失败", () => {
    expect(getRequestExecutionState({ isRunning: false, lastMessageRole: "assistant", hasError: true })).toBe("failed");
  });
});
