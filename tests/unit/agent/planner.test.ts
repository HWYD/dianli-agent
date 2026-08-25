import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

import { createQueryPlan, createRuleBasedQueryPlan, parseQueryPlanText, plannerSystemPrompt } from "@/lib/agent/planner";

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

describe("QueryPlan JSON 解析", () => {
  it("只把通过 Zod 的 JSON 交给受控执行层", () => {
    const plan = parseQueryPlanText(
      JSON.stringify({
        intent: "alarm_query",
        turbineIds: ["T04"],
        faultCodes: [],
        sources: ["alarms"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      }),
    );

    expect(plan).toMatchObject({ intent: "alarm_query", turbineIds: ["T04"] });
  });

  it("拒绝 Markdown、无效 JSON 或未验证字段，不执行修复调用", () => {
    expect(() => parseQueryPlanText("```json\n{}\n``` ")).toThrow("QueryPlan 必须是 JSON 对象");
    expect(() => parseQueryPlanText('{"intent":"alarm_query","sources":["alarms"]}')).toThrow(
      "QueryPlan 未通过 Zod 校验",
    );
  });
});

describe("QueryPlan 提示词契约", () => {
  it("提供与 Zod 一致的来源数组示例，并禁止旧的自由字段", () => {
    expect(plannerSystemPrompt).toContain('"sources": ["alarms"]');
    expect(plannerSystemPrompt).toContain('例如 ["alarms", "work_orders"]');
    expect(plannerSystemPrompt).toContain("不要使用 turbine_id、fields、answer、tools、reasoning 等其他字段");
  });
});

describe("QueryPlan 的确定性路由", () => {
  it("题外问题的规划结果不触发修复调用", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: textResult(
        JSON.stringify({
          intent: "unsupported",
          turbineIds: [],
          faultCodes: [],
          sources: [],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: false,
          queryLimit: 20,
        }),
      ),
    });

    await expect(createQueryPlan("电力是什么？", model)).resolves.toMatchObject({ intent: "unsupported", sources: [] });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("为带明确风机号的最新状态查询生成最小告警计划", () => {
    expect(createRuleBasedQueryPlan("查询 T06 的风机型号、最新运行状态和告警时间")).toEqual({
      intent: "turbine_status",
      turbineIds: ["T06"],
      faultCodes: [],
      sources: ["alarms"],
      workOrderStatuses: [],
      needsRepeatAnalysis: false,
      needsComplianceReview: false,
      queryLimit: 20,
    });
  });

  it("不把包含规程或合规要求的问题降级为单一数据库查询", () => {
    expect(createRuleBasedQueryPlan("T06 的工单关闭是否符合安全规程")).toBeNull();
  });

  it("纯规程远程复位问题不调用模型，直接生成不依赖风机编号的规程检索计划", () => {
    expect(createRuleBasedQueryPlan("哪些情形禁止远程强制复位或继续依赖反复远程复位？")).toEqual({
      intent: "policy_lookup",
      turbineIds: [],
      faultCodes: [],
      sources: ["safety_policy"],
      workOrderStatuses: [],
      needsRepeatAnalysis: false,
      needsComplianceReview: false,
      queryLimit: 20,
    });
  });

  it("规划模型首次返回无效 JSON 时只进行一次受控修复调用", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        textResult("```json\n{}\n```"),
        textResult(JSON.stringify({
          intent: "compliance_review",
          turbineIds: ["T04"],
          faultCodes: ["24013"],
          sources: ["alarms", "work_orders", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: false,
          queryLimit: 20,
        })),
      ],
    });

    const plan = await createQueryPlan("请分析 T04 的 24013 工单是否符合安全要求？", model);

    expect(plan).toMatchObject({ intent: "compliance_review", turbineIds: ["T04"], faultCodes: ["24013"] });
    expect(model.doGenerateCalls).toHaveLength(2);
  });
});
