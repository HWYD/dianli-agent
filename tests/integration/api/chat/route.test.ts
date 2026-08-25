import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/chat/route";

describe("聊天接口请求边界", () => {
  it("拒绝超过 64 KiB 的请求体，避免在解析历史会话前耗尽资源", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "a".repeat(65 * 1024) }] }] }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "请求体不能超过 64 KiB" });
  });
});
