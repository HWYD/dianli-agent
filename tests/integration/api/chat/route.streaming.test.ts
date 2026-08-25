import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepareAgentResponse: vi.fn(), streamText: vi.fn() }));

vi.mock("@/lib/agent/service", () => ({
  prepareAgentResponse: mocks.prepareAgentResponse,
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: mocks.streamText.mockImplementation(actual.streamText) };
});

import { POST } from "@/app/api/chat/route";

const model = new MockLanguageModelV3({
  doStream: {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "已完成核验。[E1]" },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ],
    }),
  },
});

describe("聊天接口流式协议", () => {
  beforeEach(() => {
    mocks.prepareAgentResponse.mockReset();
    mocks.streamText.mockClear();
    mocks.prepareAgentResponse.mockResolvedValue({
      kind: "grounded",
      model,
      prompt: "仅基于 Evidence 回答",
      evidence: [
        {
          id: "E1",
          kind: "document",
          source: "海上风电机组检修作业与安全管理规程.md",
          location: "第四章 > 第 4.1 条",
          content: "禁止远程强制复位",
        },
      ],
      claims: [
        {
          id: "C1",
          status: "prohibited",
          statement: "禁止远程强制复位。",
          evidenceIds: ["E1"],
        },
      ],
      executionSteps: [{ label: "已检索安全管理规程", status: "done" }],
    });
  });

  it("在正文开始前发送核验结论和 Evidence，避免数据事件落在 finish 之后", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "哪些情形禁止远程复位？" }] }] }),
      }),
    );

    const body = await response.text();
    const evidencePosition = body.indexOf('"type":"data-evidence"');
    const textStartPosition = body.indexOf('"type":"text-start"');
    const finishPosition = body.indexOf('"type":"finish"');

    expect(evidencePosition).toBeGreaterThan(-1);
    expect(textStartPosition).toBeGreaterThan(-1);
    expect(finishPosition).toBeGreaterThan(-1);
    expect(evidencePosition).toBeLessThan(textStartPosition);
    expect(evidencePosition).toBeLessThan(finishPosition);
  });

  it("题外问题发送范围提示和正文，不发送 Evidence", async () => {
    mocks.prepareAgentResponse.mockResolvedValueOnce({
      kind: "scope",
      answer: "## 问题范围提示\n\n当前演示仅支持随题资料范围内的问题。",
    });

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "电力是什么？" }] }] }),
      }),
    );

    const body = await response.text();
    const scopePosition = body.indexOf('"type":"data-scope"');
    const textStartPosition = body.indexOf('"type":"text-start"');

    expect(scopePosition).toBeGreaterThan(-1);
    expect(textStartPosition).toBeGreaterThan(scopePosition);
    expect(body).toContain("问题范围提示");
    expect(body).not.toContain('"type":"data-evidence"');
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
});
