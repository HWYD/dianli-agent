import { expect, test } from "@playwright/test";

test("首页展示受控数据范围和可输入的问题编辑器", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "海上风电维检 Agent" })).toBeVisible();
  await expect(page.getByText("基于随题 SQLite 与 Markdown 资料")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入维检问题" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查询 T06 的风机型号、最新运行状态和告警时间" })).toBeVisible();
});

test("通过 UI Message Stream 展示服务端核验结论、正文引用和证据来源", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    const events = [
      {
        type: "start",
        messageId: "assistant-e2e",
      },
      {
        type: "data-evidence",
        data: {
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
          invalidEvidenceIds: [],
        },
      },
      { type: "start-step" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "该情形禁止远程强制复位。[E1]" },
      { type: "text-end", id: "text-1" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "哪些情形禁止远程强制复位？" }).click();

  await expect(page.getByRole("region", { name: "核验结论" })).toContainText("禁止远程强制复位");
  await expect(page.getByText("该情形禁止远程强制复位。[E1]")).toBeVisible();
  await expect(page.getByRole("link", { name: "[E1]" }).first()).toHaveAttribute("href", "#evidence-assistant-e2e-E1");
});

test("题外问题展示范围提示和题目内推荐问题", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    const events = [
      { type: "start", messageId: "assistant-scope" },
      { type: "data-scope", data: { kind: "out_of_scope" } },
      { type: "text-start", id: "scope-1" },
      {
        type: "text-delta",
        id: "scope-1",
        delta: "## 问题范围提示\n\n当前演示仅基于随题提供的资料回答问题。",
      },
      { type: "text-end", id: "scope-1" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "输入维检问题" }).fill("电力是什么？");
  await page.getByRole("button", { name: "发送问题" }).click();

  await expect(page.getByRole("heading", { name: "问题范围提示" })).toBeVisible();
  await expect(page.getByRole("region", { name: "推荐问题" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByText("思考失败")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "核验结论" })).toHaveCount(0);
  await expect(page.getByText(/依据来源/)).toHaveCount(0);
});
