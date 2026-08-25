import { describe, expect, it } from "vitest";

import { getEvidenceAnchorId } from "@/lib/ui/evidence-anchors";

describe("证据锚点", () => {
  it("为不同回答中的同一 Evidence 编号生成不同 DOM 锚点", () => {
    expect(getEvidenceAnchorId("assistant-1", "E1")).toBe("evidence-assistant-1-E1");
    expect(getEvidenceAnchorId("assistant-2", "E1")).toBe("evidence-assistant-2-E1");
  });

  it("移除消息 ID 中不适合 DOM id 的字符", () => {
    expect(getEvidenceAnchorId("assistant: 1/2", "E12")).toBe("evidence-assistant-1-2-E12");
  });
});
