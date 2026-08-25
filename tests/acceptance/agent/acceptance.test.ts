import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createWindFarmRepository, openReadOnlyDatabase, type ReadOnlyDatabase } from "@/lib/data/repository";
import { loadBusinessDocumentChunks } from "@/lib/rag/documents";
import { createHybridRetriever } from "@/lib/rag/retriever";
import { collectControlledEvidence, type ControlledEvidenceResult } from "@/lib/agent/runner";
import type { SupportedQueryPlan } from "@/lib/agent/schemas";

const retriever = createHybridRetriever(loadBusinessDocumentChunks());
let database: ReadOnlyDatabase;

function hasClause(result: ControlledEvidenceResult, clauseId: string): boolean {
  return result.evidence.some((evidence) => evidence.queryParameters?.clauseId === clauseId);
}

function hasClaim(result: ControlledEvidenceResult, fragment: string): boolean {
  return result.claims.some((claim) => claim.statement.includes(fragment));
}

async function execute(question: string, plan: SupportedQueryPlan): Promise<ControlledEvidenceResult> {
  return collectControlledEvidence({
    question,
    plan,
    repository: createWindFarmRepository(database),
    retriever,
  });
}

beforeAll(() => {
  database = openReadOnlyDatabase();
});

afterAll(() => {
  closeDatabase(database);
});

describe("11 题离线验收", () => {
  it("T01：返回最新状态所需的数据库证据", async () => {
    const result = await execute("查询 T06 的风机型号、最新运行状态和告警时间", {
      intent: "turbine_status", turbineIds: ["T06"], faultCodes: [], sources: ["alarms"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: false, queryLimit: 20,
    });
    expect(result.evidence[0]?.content).toMatchObject({ turbine_model: "OWT-5.0A", turbine_status: "STOPPED" });
  });

  it("T02：按闭区间返回 T04 的两条告警", async () => {
    const result = await execute("查询 T04 在 2026-07-10 00:00:00 至 2026-07-15 23:59:59 期间的告警记录", {
      intent: "alarm_query", turbineIds: ["T04"], faultCodes: [], sources: ["alarms"], timeRange: { from: "2026-07-10 00:00:00", to: "2026-07-15 23:59:59" }, workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: false, queryLimit: 20,
    });
    expect(result.evidence[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ fault_code: "24001", occurred_at: "2026-07-11 02:40:00" }),
      expect.objectContaining({ fault_code: "24013", occurred_at: "2026-07-14 22:05:00" }),
    ]));
  });

  it("T03：按故障代码锁定 24002 手册章节", async () => {
    const result = await execute("根据故障处理手册回答 24002_SC_变流器心跳的常见原因、检查项目和安全注意事项", {
      intent: "fault_guidance", turbineIds: [], faultCodes: ["24002"], sources: ["fault_manual"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: false, queryLimit: 20,
    });
    expect(result.evidence[0]?.content).toEqual(expect.stringContaining("检查通讯线外观"));
  });

  it("T04：纯规程问题不读数据库，并保留禁止远程复位条款", async () => {
    const result = await execute("哪些情形禁止远程强制复位或继续依赖反复远程复位？", {
      intent: "policy_lookup", turbineIds: [], faultCodes: [], sources: ["safety_policy"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: false, queryLimit: 20,
    });
    expect(result.evidence.every((evidence) => evidence.kind === "document")).toBe(true);
    expect(hasClause(result, "4.1")).toBe(true);
    expect(hasClaim(result, "禁止远程强制复位")).toBe(true);
  });

  it("T05：T03/24002 重复故障升级为 HIGH 并禁止反复远程复位", async () => {
    const result = await execute("分析 T03 的 24002 重复故障、NORMAL 工单优先级和远程复位要求", {
      intent: "compliance_review", turbineIds: ["T03"], faultCodes: ["24002"], sources: ["alarms", "work_orders", "fault_manual", "safety_policy"], workOrderStatuses: [], needsRepeatAnalysis: true, needsComplianceReview: true, queryLimit: 20,
    });
    expect(hasClaim(result, "最多发生 4 次，属于重复故障")).toBe(true);
    expect(hasClaim(result, "应至少为 HIGH")).toBe(true);
    expect(hasClause(result, "3.2")).toBe(true);
    expect(hasClause(result, "4.1")).toBe(true);
  });

  it("T06：T09 的 15 分钟观察时间不满足关闭要求", async () => {
    const result = await execute("检查 T09 的 24011 已完成工单是否符合关闭要求，15 分钟观察时间是否达标", {
      intent: "compliance_review", turbineIds: ["T09"], faultCodes: ["24011"], sources: ["work_orders", "safety_policy"], workOrderStatuses: ["COMPLETED"], needsRepeatAnalysis: false, needsComplianceReview: true, queryLimit: 20,
    });
    expect(hasClaim(result, "关闭记录不合规")).toBe(true);
    expect(hasClaim(result, "不少于 120 分钟")).toBe(true);
    expect(hasClause(result, "6.4")).toBe(true);
  });

  it("T07：T07/24012 未达到重复阈值，且未查到关联工单", async () => {
    const result = await execute("分析 T07 的 24012 在 24 小时内的次数、工单和检查项目", {
      intent: "composite", turbineIds: ["T07"], faultCodes: ["24012"], sources: ["alarms", "work_orders", "fault_manual", "safety_policy"], timeRange: { from: "2026-07-18 08:00:00", to: "2026-07-19 08:00:00" }, workOrderStatuses: [], needsRepeatAnalysis: true, needsComplianceReview: false, queryLimit: 20,
    });
    expect(hasClaim(result, "最多发生 2 次，未达到重复故障标准")).toBe(true);
    expect(result.evidence.find((evidence) => evidence.source === "maintenance_records")?.content).toEqual(expect.objectContaining({ message: expect.stringContaining("未查询到") }));
    expect(result.evidence.find((evidence) => evidence.source === "故障处理手册.md")?.content).toEqual(expect.stringContaining("终端电阻"));
  });

  it("示例一：T01 的最新状态走最小数据库路径", async () => {
    const result = await execute("T01 的风机型号是什么？根据最新一条告警记录，最近一次运行状态是什么？", {
      intent: "turbine_status", turbineIds: ["T01"], faultCodes: [], sources: ["alarms"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: false, queryLimit: 20,
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.content).toMatchObject({ turbine_status: "RUNNING" });
  });

  it("示例二：24006 只读取故障手册", async () => {
    const result = await execute("24006_SC_变流器低穿激活的触发条件和处理建议是什么？", {
      intent: "fault_guidance", turbineIds: [], faultCodes: ["24006"], sources: ["fault_manual"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: false, queryLimit: 20,
    });
    expect(result.evidence.every((evidence) => evidence.source === "故障处理手册.md")).toBe(true);
    expect(result.evidence.some((evidence) => String(evidence.content).includes("电网电压跌落"))).toBe(true);
  });

  it("示例三：T05 急停工单必须提升为 EMERGENCY", async () => {
    const result = await execute("T05 当前的急停故障是否已经得到符合规定的工单安排？", {
      intent: "compliance_review", turbineIds: ["T05"], faultCodes: ["24005"], sources: ["alarms", "work_orders", "safety_policy"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: true, queryLimit: 20,
    });
    expect(hasClaim(result, "应至少为 EMERGENCY")).toBe(true);
    expect(hasClause(result, "2.1")).toBe(true);
    expect(hasClause(result, "4.1")).toBe(true);
  });

  it("示例四：T08 因备件不可用和现场条件缺失不能确认立即更换", async () => {
    const result = await execute("T08 的 24010 故障是否已经具备立即更换控制单板的条件？", {
      intent: "compliance_review", turbineIds: ["T08"], faultCodes: ["24010"], sources: ["alarms", "work_orders", "fault_manual", "safety_policy"], workOrderStatuses: [], needsRepeatAnalysis: false, needsComplianceReview: true, queryLimit: 20,
    });
    expect(hasClaim(result, "备件当前不可用")).toBe(true);
    expect(hasClaim(result, "主电源隔离")).toBe(true);
    expect(hasClause(result, "5.2")).toBe(true);
    expect(hasClause(result, "7.2")).toBe(true);
  });
});
