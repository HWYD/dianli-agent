// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, expect, it, beforeEach, afterEach } from "vitest";

const { useChatMock } = vi.hoisted(() => ({ useChatMock: vi.fn() }));

vi.mock("@ai-sdk/react", () => ({ useChat: useChatMock }));

import { WindPowerChat } from "@/components/chat/wind-power-chat";

function createChatState() {
  return {
    messages: [
      {
        id: "assistant: 1",
        role: "assistant",
        parts: [
          {
            type: "data-evidence",
            data: {
              evidence: [
                {
                  id: "E1",
                  kind: "derived",
                  source: "工单优先级复核",
                  location: "规程第 3.2 条",
                  content: { requiredPriority: "HIGH" },
                },
              ],
              claims: [
                {
                  id: "C1",
                  status: "non_compliant",
                  statement: "工单 WO-260703 当前为 NORMAL，未达到应至少为 HIGH 的优先级要求。",
                  evidenceIds: ["E1"],
                },
              ],
              executionSteps: [],
              invalidEvidenceIds: [],
            },
          },
          { type: "text", text: "当前工单优先级不合规。[E1]" },
        ],
      },
    ],
    status: "ready",
    error: undefined,
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    stop: vi.fn(),
    clearError: vi.fn(),
  };
}

describe("WindPowerChat", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    useChatMock.mockReturnValue(createChatState());
  });

  it("在模型正文之前展示服务端核验结论，并把结论引用指向本轮来源", () => {
    render(<WindPowerChat />);

    expect(screen.getByRole("region", { name: "核验结论" }).textContent).toContain("应至少为 HIGH");
    const evidenceLinks = screen.getAllByRole("link", { name: "[E1]" });
    expect(evidenceLinks[0]?.getAttribute("href")).toBe("#evidence-assistant-1-E1");
    expect(document.getElementById("evidence-assistant-1-E1")).not.toBeNull();
  });

  it("最新回答生成中隐藏核验结论和依据来源，完成后再展示", () => {
    const streamingState = createChatState();
    streamingState.status = "streaming";
    useChatMock.mockReturnValue(streamingState);

    const { rerender } = render(<WindPowerChat />);

    expect(screen.queryByRole("region", { name: "核验结论" })).toBeNull();
    expect(screen.queryByText("依据来源（1）")).toBeNull();

    useChatMock.mockReturnValue({ ...streamingState, status: "ready" });
    rerender(<WindPowerChat />);

    expect(screen.getByRole("region", { name: "核验结论" })).toBeTruthy();
    expect(screen.getByText("依据来源（1）")).toBeTruthy();
  });

  it("题外问题展示范围提示和推荐问题，不展示失败或证据区块", () => {
    useChatMock.mockReturnValue({
      ...createChatState(),
      messages: [
        {
          id: "assistant: scope",
          role: "assistant",
          parts: [
            { type: "data-scope", data: { kind: "out_of_scope" } },
            {
              type: "text",
              text: "## 问题范围提示\n\n当前演示仅基于随题提供的资料回答问题。",
            },
          ],
        },
      ],
    });

    render(<WindPowerChat />);

    expect(screen.getByRole("heading", { name: "问题范围提示" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "推荐问题" })).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByText("已完成思考")).toBeNull();
    expect(screen.queryByText("思考失败")).toBeNull();
    expect(screen.queryByRole("region", { name: "核验结论" })).toBeNull();
    expect(screen.queryByText(/依据来源/)).toBeNull();
  });

  it("在流式正文出现未知 Evidence 引用时即时展示警告", () => {
    const state = createChatState();
    state.messages[0]!.parts[1] = { type: "text", text: "当前结论需要复核。[E9]" };
    useChatMock.mockReturnValue(state);

    render(<WindPowerChat />);

    expect(screen.getByText("正文含未验证引用：[E9]")).toBeTruthy();
  });

  it("将流式正文的 Markdown 加粗渲染为语义元素，并保留受控 Evidence 锚点", () => {
    const state = createChatState();
    state.messages[0]!.parts[1] = { type: "text", text: "**风机型号**：OWT-5.0A [E1]" };
    useChatMock.mockReturnValue(state);

    render(<WindPowerChat />);

    expect(screen.getByText("风机型号").tagName).toBe("STRONG");
    expect(document.querySelector(".answer-markdown a")?.getAttribute("href")).toBe("#evidence-assistant-1-E1");
  });

  it("生成中将发送按钮变为可用的停止按钮", async () => {
    const stop = vi.fn();
    useChatMock.mockReturnValue({
      ...createChatState(),
      status: "streaming",
      stop,
    });

    render(<WindPowerChat />);
    await userEvent.click(screen.getByRole("button", { name: "停止生成" }));

    expect(stop).toHaveBeenCalledOnce();
  });

});
