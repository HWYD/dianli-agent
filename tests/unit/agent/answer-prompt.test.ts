import { describe, expect, it } from "vitest";

import { createAnswerPrompt } from "@/lib/agent/answer-prompt";

describe("最终回答 Prompt", () => {
  it("只将受控 Evidence 交给最终模型，并要求可追溯引用", () => {
    const prompt = createAnswerPrompt("T06 最新状态是什么？", [
      {
        id: "E1",
        kind: "database",
        source: "alarm_records",
        location: "最新记录",
        content: { turbine_status: "STOPPED" },
      },
    ]);

    expect(prompt).toContain("只能依据下方 Evidence");
    expect(prompt).toContain("[E1]");
    expect(prompt).toContain("STOPPED");
    expect(prompt).not.toContain("AnswerPayload");
  });

  it("约束多子问题、记录边界和证据不足的表达方式", () => {
    const prompt = createAnswerPrompt("T06 当前状态是否允许远程复位？", [
      {
        id: "E1",
        kind: "database",
        source: "alarm_records",
        location: "最新记录",
        content: { turbine_status: "STOPPED" },
      },
    ]);

    expect(prompt).toContain("按用户问题中的每个子问题逐项回答");
    expect(prompt).toContain("不等同于实时现场状态");
    expect(prompt).toContain("查询结果为空只能说明未检索到匹配记录");
    expect(prompt).toContain("现有资料无法确认，需要现场核实");
    expect(prompt).toContain("不要为未被用户询问且不影响结论的事项扩展不确定性");
    expect(prompt).toContain("## 分析结果");
  });

  it("把服务端核验结论置于原始 Evidence 之前，要求模型不得改写硬结论", () => {
    const prompt = createAnswerPrompt(
      "T03 工单是否需要升级？",
      [
        {
          id: "E1",
          kind: "derived",
          source: "工单优先级复核",
          location: "规程第 3.2 条",
          content: { status: "non_compliant" },
        },
      ],
      [
        {
          id: "C1",
          status: "non_compliant",
          statement: "工单 WO-260703 当前为 NORMAL，未达到应至少为 HIGH 的优先级要求。",
          evidenceIds: ["E1"],
        },
      ],
    );

    expect(prompt).toContain("服务端核验结论优先于原始 Evidence");
    expect(prompt).toContain("不得否定、弱化或改写其中的结论");
    expect(prompt).toContain("工单 WO-260703 当前为 NORMAL");
    expect(prompt.indexOf("--- BEGIN VERIFIED CLAIMS ---")).toBeLessThan(prompt.indexOf("--- BEGIN CONTROLLED EVIDENCE ---"));
  });
});
