import { describe, expect, it } from "vitest";

import {
  evidencePartDataSchema,
  executionProgressPartDataSchema,
  queryPlanSchema,
  scopePartDataSchema,
  userQuestionSchema,
} from "@/lib/agent/schemas";

describe("QueryPlan 契约", () => {
  it("接受受控的跨数据源查询计划", () => {
    const result = queryPlanSchema.parse({
      intent: "compliance_review",
      turbineIds: ["T03"],
      faultCodes: ["24002"],
      sources: ["alarms", "work_orders", "safety_policy"],
      needsRepeatAnalysis: true,
      needsComplianceReview: true,
      queryLimit: 20,
    });

    expect(result.turbineIds).toEqual(["T03"]);
    expect(result.queryLimit).toBe(20);
  });

  it("拒绝未在白名单内的来源、风机号和超出上限的查询", () => {
    expect(() =>
      queryPlanSchema.parse({
        intent: "alarm_query",
        turbineIds: ["T10"],
        faultCodes: [],
        sources: ["arbitrary_sql"],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 999,
      }),
    ).toThrow();
  });

  it("只接受无检索条件的题外问题安全包络", () => {
    const unsupportedPlan = {
      intent: "unsupported",
      turbineIds: [],
      faultCodes: [],
      sources: [],
      workOrderStatuses: [],
      needsRepeatAnalysis: false,
      needsComplianceReview: false,
      queryLimit: 20,
    };

    expect(queryPlanSchema.parse(unsupportedPlan)).toMatchObject({ intent: "unsupported", sources: [] });
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, sources: ["alarms"] })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, turbineIds: ["T01"] })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, faultCodes: ["24002"] })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, workOrderStatuses: ["COMPLETED"] })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, needsRepeatAnalysis: true })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, needsComplianceReview: true })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, queryLimit: 19 })).toThrow();
    expect(() => queryPlanSchema.parse({ ...unsupportedPlan, timeRange: { from: "2026-07-10 00:00:00" } })).toThrow();
  });

  it("只允许受控阶段和已完成步骤进入实时进度数据", () => {
    const progress = executionProgressPartDataSchema.parse({
      phase: "retrieving",
      completedSteps: [{ label: "已查询维检工单记录", status: "done" }],
    });

    expect(progress.phase).toBe("retrieving");
    expect(progress.completedSteps).toHaveLength(1);
    expect(() =>
      executionProgressPartDataSchema.parse({
        phase: "reasoning",
        completedSteps: [{ label: "执行任意 SQL", status: "running" }],
      }),
    ).toThrow();
  });

  it("只接受服务端标记的题外范围提示数据", () => {
    expect(scopePartDataSchema.parse({ kind: "out_of_scope" })).toEqual({ kind: "out_of_scope" });
    expect(() => scopePartDataSchema.parse({ kind: "out_of_scope", answer: "任意文本" })).toThrow();
  });
});

describe("用户输入与证据数据契约", () => {
  it("限制问题长度，避免把无界输入交给规划器", () => {
    expect(userQuestionSchema.safeParse("查询 T06 最新状态").success).toBe(true);
    expect(userQuestionSchema.safeParse(" ").success).toBe(false);
    expect(userQuestionSchema.safeParse("a".repeat(1001)).success).toBe(false);
  });

  it("只接受服务端生成的结构化证据与受控步骤", () => {
    const result = evidencePartDataSchema.parse({
      evidence: [
        {
          id: "E1",
          kind: "database",
          source: "alarm_records",
          location: "occurred_at DESC, alarm_id DESC",
          content: { turbine_id: "T06", turbine_status: "STOPPED" },
        },
      ],
      executionSteps: [{ label: "已查询运行告警记录", status: "done" }],
      claims: [
        {
          id: "C1",
          status: "confirmed",
          statement: "T03/24002 属于重复故障。",
          evidenceIds: ["E1"],
        },
      ],
    });

    expect(result.evidence[0]?.id).toBe("E1");
    expect(result.executionSteps).toHaveLength(1);
    expect(result.claims[0]?.id).toBe("C1");
  });
});
