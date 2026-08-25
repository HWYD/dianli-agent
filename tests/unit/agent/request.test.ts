import { describe, expect, it } from "vitest";

import { extractLatestUserQuestion } from "@/lib/agent/request";

describe("聊天请求边界", () => {
  it("只提取最后一条用户消息的文本，不把历史回答交给规划器", () => {
    const question = extractLatestUserQuestion([
      { role: "user", parts: [{ type: "text", text: "旧问题" }] },
      { role: "assistant", parts: [{ type: "text", text: "旧答案" }] },
      { role: "user", parts: [{ type: "text", text: "T06 最新状态是什么？" }] },
    ]);

    expect(question).toBe("T06 最新状态是什么？");
  });

  it("拒绝没有用户文本或超长的请求", () => {
    expect(() => extractLatestUserQuestion([{ role: "assistant", parts: [] }])).toThrow("最后一条消息必须来自用户");
    expect(() =>
      extractLatestUserQuestion([{ role: "user", parts: [{ type: "text", text: "a".repeat(1001) }] }]),
    ).toThrow("问题长度");
  });
});
