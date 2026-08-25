import { describe, expect, it } from "vitest";

import { getSafeChatErrorMessage } from "@/lib/agent/request-errors";

describe("聊天请求的脱敏错误提示", () => {
  it("为未通过查询计划校验的请求提供可操作提示", () => {
    expect(getSafeChatErrorMessage(new Error("QueryPlan 未通过 Zod 校验"))).toBe(
      "查询规划未通过安全校验，请换一种更明确的表述后重试。",
    );
  });

  it("为缺少文档索引的请求提示本地初始化命令", () => {
    expect(getSafeChatErrorMessage(new Error("ENOENT: no such file or directory, open 'data/rag-index.json'"))).toBe(
      "文档索引尚未初始化或已过期，请运行 pnpm ingest:docs 后重试。",
    );
  });

  it("不向客户端透传其他内部错误", () => {
    expect(getSafeChatErrorMessage(new Error("provider request failed: sensitive detail"))).toBe(
      "回答生成失败，请检查本地环境后重新提交问题。",
    );
  });

  it("为模型调用超时提供脱敏提示", () => {
    expect(getSafeChatErrorMessage(new Error("Request timed out after 45000ms"))).toBe(
      "本次请求超时，请检查本地网络后重新提交问题。",
    );
  });
});
