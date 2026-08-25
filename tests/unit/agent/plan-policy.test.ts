import { describe, expect, it } from "vitest";

import { normalizeQueryPlan } from "@/lib/agent/plan-policy";

describe("QueryPlan 的确定性边界", () => {
  it("题外问题保持无检索条件，不补充任何资料来源", () => {
    const plan = normalizeQueryPlan(
      {
        intent: "unsupported",
        turbineIds: [],
        faultCodes: [],
        sources: [],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      },
      "电力是什么？",
    );

    expect(plan).toMatchObject({
      intent: "unsupported",
      turbineIds: [],
      faultCodes: [],
      sources: [],
      workOrderStatuses: [],
      needsRepeatAnalysis: false,
      needsComplianceReview: false,
    });
  });

  it("纯规程远程复位问题只使用安全规程，不要求工单来源", () => {
    const plan = normalizeQueryPlan(
      {
        intent: "compliance_review",
        turbineIds: [],
        faultCodes: [],
        sources: ["safety_policy"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: true,
        queryLimit: 20,
      },
      "哪些情形禁止远程强制复位或继续反复远程复位？",
    );

    expect(plan.sources).toEqual(["safety_policy"]);
  });

  it("更换条件问题保留告警、工单、手册和规程四类来源", () => {
    const plan = normalizeQueryPlan(
      {
        intent: "fault_guidance",
        turbineIds: ["T08"],
        faultCodes: ["24010"],
        sources: ["alarms", "work_orders", "fault_manual", "safety_policy"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      },
      "T08 的 24010 故障是否已经具备立即更换控制单板的条件？",
    );

    expect(plan.sources).toEqual(["alarms", "work_orders", "fault_manual", "safety_policy"]);
  });

  it("重复故障和关闭合规性由问题语义强制开启", () => {
    const repeatPlan = normalizeQueryPlan(
      {
        intent: "work_order_query",
        turbineIds: ["T03"],
        faultCodes: ["24002"],
        sources: ["work_orders"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      },
      "T03 的 24002 是否属于重复故障，工单应如何调整？",
    );
    const closurePlan = normalizeQueryPlan(
      {
        intent: "work_order_query",
        turbineIds: ["T09"],
        faultCodes: ["24011"],
        sources: ["work_orders"],
        workOrderStatuses: ["COMPLETED"],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      },
      "T09 的 24011 已完成工单是否符合关闭要求？",
    );

    expect(repeatPlan.needsRepeatAnalysis).toBe(true);
    expect(closurePlan.needsComplianceReview).toBe(true);
  });

  it("以用户问题中的明确风机、故障码和闭区间覆盖模型猜测", () => {
    const plan = normalizeQueryPlan(
      {
        intent: "alarm_query",
        turbineIds: ["T01"],
        faultCodes: [],
        sources: ["alarms"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      },
      "查询 T04 的 24013，在 2026-07-10 00:00:00 至 2026-07-15 23:59:59 的告警",
    );

    expect(plan.turbineIds).toEqual(["T04"]);
    expect(plan.faultCodes).toEqual(["24013"]);
    expect(plan.timeRange).toEqual({ from: "2026-07-10 00:00:00", to: "2026-07-15 23:59:59" });
  });

  it("为重复故障和工单合规性补足服务端固定的必要来源", () => {
    const plan = normalizeQueryPlan(
      {
        intent: "compliance_review",
        turbineIds: ["T03"],
        faultCodes: ["24002"],
        sources: ["fault_manual"],
        workOrderStatuses: [],
        needsRepeatAnalysis: true,
        needsComplianceReview: true,
        queryLimit: 20,
      },
      "分析 T03 的 24002 重复故障",
    );

    expect(plan.sources).toEqual(
      expect.arrayContaining(["alarms", "work_orders", "fault_manual", "safety_policy"]),
    );
  });

  it("为当前故障的工单合规性问题补齐告警来源，并保留模型选择的手册来源", () => {
    const plan = normalizeQueryPlan(
      {
        intent: "compliance_review",
        turbineIds: ["T05"],
        faultCodes: ["24005"],
        sources: ["fault_manual"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: true,
        queryLimit: 20,
      },
      "T05 当前的急停故障是否已经得到符合规定的工单安排？",
    );

    expect(plan.sources).toEqual(["alarms", "work_orders", "fault_manual", "safety_policy"]);
  });
});
