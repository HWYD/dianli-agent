import { describe, expect, it, vi } from "vitest";

import { closeDatabase, createWindFarmRepository, openReadOnlyDatabase, type WindFarmRepository } from "@/lib/data/repository";
import { loadBusinessDocumentChunks } from "@/lib/rag/documents";
import { createHybridRetriever } from "@/lib/rag/retriever";
import { collectControlledEvidence } from "@/lib/agent/runner";

const retriever = createHybridRetriever(loadBusinessDocumentChunks());

describe("Controlled Agent 证据执行", () => {
  it("每完成一个受控步骤就向进度消费者上报一次", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);
    const reportedSteps: Array<{ label: string; status: string }> = [];

    try {
      await collectControlledEvidence({
        question: "T06 最新状态是什么？",
        plan: {
          intent: "turbine_status",
          turbineIds: ["T06"],
          faultCodes: [],
          sources: ["alarms"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: false,
          queryLimit: 20,
        },
        repository,
        retriever,
        onStep: (step) => reportedSteps.push(step),
      });

      expect(reportedSteps).toEqual([{ label: "已查询运行告警记录", status: "done" }]);
    } finally {
      closeDatabase(database);
    }
  });

  it("状态问题只执行受控告警查询，不无故检索业务文档", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "T06 最新状态是什么？",
        plan: {
          intent: "turbine_status",
          turbineIds: ["T06"],
          faultCodes: [],
          sources: ["alarms"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: false,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]).toMatchObject({ source: "alarm_records" });
      expect(result.executionSteps.map((step) => step.label)).toEqual(["已查询运行告警记录"]);
    } finally {
      closeDatabase(database);
    }
  });

  it("重复故障分析融合告警、工单、规程和故障手册证据", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "分析 T03 的 24002 重复故障和远程复位要求",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T03"],
          faultCodes: ["24002"],
          sources: ["alarms", "work_orders", "fault_manual", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: true,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      expect(result.evidence.some((evidence) => evidence.kind === "derived" && evidence.source === "重复故障计算")).toBe(
        true,
      );
      expect(result.evidence.some((evidence) => evidence.source === "maintenance_records")).toBe(true);
      expect(result.evidence.some((evidence) => evidence.source === "故障处理手册.md")).toBe(true);
      expect(result.evidence.some((evidence) => evidence.source === "海上风电机组检修作业与安全管理规程.md")).toBe(
        true,
      );
      expect(result.executionSteps.length).toBeLessThanOrEqual(8);
    } finally {
      closeDatabase(database);
    }
  });

  it("完成工单的合规性由确定性规则复核，而不是仅看状态", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "T09 的 24011 工单符合关闭要求吗？",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T09"],
          faultCodes: ["24011"],
          sources: ["work_orders", "fault_manual", "safety_policy"],
          workOrderStatuses: ["COMPLETED"],
          needsRepeatAnalysis: false,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      expect(
        result.evidence.find((evidence) => evidence.source === "工单关闭合规性复核")?.content,
      ).toMatchObject({ status: "non_compliant" });
    } finally {
      closeDatabase(database);
    }
  });

  it("分别检索所需的手册和规程，避免一种文档挤占另一种候选", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);
    const retrievalCalls: string[][] = [];

    try {
      const result = await collectControlledEvidence({
        question: "T03 的 24002 重复故障应检查什么，是否可以远程复位？",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T03"],
          faultCodes: ["24002"],
          sources: ["alarms", "fault_manual", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: true,
          needsComplianceReview: false,
          queryLimit: 20,
        },
        repository,
        retriever: {
          async retrieve(_question, options) {
            const documentTypes = (options as { documentTypes?: string[] } | undefined)?.documentTypes ?? [];
            retrievalCalls.push(documentTypes);
            const documentType = documentTypes[0];
            const chunks = loadBusinessDocumentChunks()
              .filter((chunk) => chunk.metadata.documentType === documentType)
              .slice(0, 1);
            return { chunks, context: "", degraded: false, exactMatches: [] };
          },
        },
      });

      expect(retrievalCalls).toEqual([["fault_manual"], ["safety_policy"]]);
      expect(result.evidence.filter((evidence) => evidence.kind === "document").map((evidence) => evidence.source)).toEqual(
        ["故障处理手册.md", "海上风电机组检修作业与安全管理规程.md"],
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("纯规程问题不要求风机编号，也不会查询数据库", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "哪些情形禁止远程强制复位或继续依赖反复远程复位？",
        plan: {
          intent: "compliance_review",
          turbineIds: [],
          faultCodes: [],
          sources: ["safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: false,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      expect(result.evidence.every((evidence) => evidence.kind === "document")).toBe(true);
      expect(result.evidence.some((evidence) => evidence.queryParameters?.clauseId === "4.1")).toBe(true);
    } finally {
      closeDatabase(database);
    }
  });

  it("将重复故障的工单升级要求作为派生证据，而不是交给回答模型猜测", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "T03 的 24002 在 24 小时内发生四次，当前 NORMAL 工单应调整为什么优先级？",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T03"],
          faultCodes: ["24002"],
          sources: ["alarms", "work_orders", "fault_manual", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: true,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      expect(result.evidence.find((evidence) => evidence.source === "工单优先级复核")?.content).toMatchObject({
        status: "non_compliant",
        currentPriority: "NORMAL",
        requiredPriority: "HIGH",
      });
      expect(result.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "confirmed", statement: expect.stringContaining("属于重复故障") }),
          expect.objectContaining({ status: "non_compliant", statement: expect.stringContaining("应至少为 HIGH") }),
        ]),
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("将备件不可用和现场安全条件缺失作为立即更换核验结论", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "T08 的 24010 故障是否已经具备立即更换控制单板的条件？",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T08"],
          faultCodes: ["24010"],
          sources: ["alarms", "work_orders", "fault_manual", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      expect(result.evidence.find((evidence) => evidence.source === "立即更换条件核验")?.content).toMatchObject({
        partAvailable: false,
        canConfirmImmediateReplacement: false,
      });
    } finally {
      closeDatabase(database);
    }
  });

  it("关闭合规问题固定带回第 6.1、6.3、6.4、6.5 条，而非依赖混合检索排序", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "T09 的 24011 已完成工单是否符合关闭要求？15 分钟观察时间是否达标？",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T09"],
          faultCodes: ["24011"],
          sources: ["work_orders", "safety_policy"],
          workOrderStatuses: ["COMPLETED"],
          needsRepeatAnalysis: false,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      const clauseIds = result.evidence
        .filter((evidence) => evidence.kind === "document")
        .map((evidence) => evidence.queryParameters?.clauseId);
      expect(clauseIds).toEqual(expect.arrayContaining(["6.1", "6.3", "6.4", "6.5"]));
    } finally {
      closeDatabase(database);
    }
  });

  it("急停工单复核固定关联第 2.1 和第 4.1 条，并输出 EMERGENCY 结论", async () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const result = await collectControlledEvidence({
        question: "T05 当前急停故障是否已经得到符合规定的工单安排？",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T05"],
          faultCodes: ["24005"],
          sources: ["alarms", "work_orders", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      });

      const clauseIds = result.evidence
        .filter((evidence) => evidence.kind === "document")
        .map((evidence) => evidence.queryParameters?.clauseId);
      expect(clauseIds).toEqual(expect.arrayContaining(["2.1", "4.1"]));
      expect(result.claims).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "non_compliant", statement: expect.stringContaining("EMERGENCY") }),
        ]),
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("在受控工具预算超限前拒绝多风机多故障查询，不执行部分数据库查询", async () => {
    const repository = {
      getLatestAlarm: vi.fn(),
      listAlarms: vi.fn(() => []),
      findWorkOrders: vi.fn(() => []),
    } as unknown as WindFarmRepository;

    await expect(
      collectControlledEvidence({
        question: "查询 T01、T02、T03 的 24001 和 24002 告警及工单",
        plan: {
          intent: "composite",
          turbineIds: ["T01", "T02", "T03"],
          faultCodes: ["24001", "24002"],
          sources: ["alarms", "work_orders"],
          workOrderStatuses: [],
          needsRepeatAnalysis: false,
          needsComplianceReview: false,
          queryLimit: 20,
        },
        repository,
        retriever,
      }),
    ).rejects.toThrow("查询范围超过受控 8 次上限");

    expect(repository.listAlarms).not.toHaveBeenCalled();
    expect(repository.findWorkOrders).not.toHaveBeenCalled();
  });

  it("在 Evidence 预算超限前拒绝多故障组合，避免向客户端发送不符合协议的数据", async () => {
    const repository = {
      getLatestAlarm: vi.fn(),
      listAlarms: vi.fn(() => []),
      findWorkOrders: vi.fn(() => []),
    } as unknown as WindFarmRepository;

    await expect(
      collectControlledEvidence({
        question: "分析 T05 的 24001、24002、24005 重复故障、工单优先级、远程复位要求",
        plan: {
          intent: "compliance_review",
          turbineIds: ["T05"],
          faultCodes: ["24001", "24002", "24005"],
          sources: ["alarms", "work_orders", "fault_manual", "safety_policy"],
          workOrderStatuses: [],
          needsRepeatAnalysis: true,
          needsComplianceReview: true,
          queryLimit: 20,
        },
        repository,
        retriever,
      }),
    ).rejects.toThrow("可追溯 Evidence 超过单轮 16 条上限");

    expect(repository.listAlarms).not.toHaveBeenCalled();
    expect(repository.findWorkOrders).not.toHaveBeenCalled();
  });

  it("将同一受控工单查询的批量合规结果聚合为一条 Evidence", async () => {
    const repository = {
      getLatestAlarm: vi.fn(),
      listAlarms: vi.fn(() => []),
      findWorkOrders: vi.fn(() =>
        Array.from({ length: 20 }, (_, index) => ({
          work_order_id: `WO-${index + 1}`,
          turbine_id: "T01",
          fault_code: "24001",
          priority: "NORMAL",
          status: "COMPLETED",
          created_at: "2026-07-18 08:00:00",
          resolution_note: null,
          observation_minutes: 120,
          required_part: null,
          part_available: null,
        })),
      ),
    } as unknown as WindFarmRepository;

    const result = await collectControlledEvidence({
      question: "T01 的 24001 工单是否符合关闭要求？",
      plan: {
        intent: "compliance_review",
        turbineIds: ["T01"],
        faultCodes: ["24001"],
        sources: ["work_orders"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: true,
        queryLimit: 20,
      },
      repository,
      retriever,
    });

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1]).toMatchObject({
      source: "工单关闭合规性复核",
      content: { assessments: expect.arrayContaining([expect.objectContaining({ workOrderId: "WO-1" })]) },
    });
    expect(result.claims).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "non_compliant", statement: expect.stringContaining("共 20 张工单") })]),
    );
  });
});
