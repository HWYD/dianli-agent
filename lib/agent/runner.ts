import {
  assessPriorityReview,
  assessReplacementReadiness,
  assessWorkOrderClosure,
  findRepeatFaultWindow,
} from "./business-rules";
import { buildVerifiedClaims } from "./claims";
import type { Evidence, EvidencePartData, SupportedQueryPlan } from "./schemas";
import type { WindFarmRepository } from "../data/repository";
import type { HybridRetrieveOptions, HybridRetrieveResult } from "../rag/retriever";

const maxToolExecutions = 8;
const maxEvidenceItems = 16;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function estimateToolExecutions(plan: SupportedQueryPlan): number {
  const turbineCount = plan.turbineIds.length;
  const faultCodeCount = Math.max(1, plan.faultCodes.length);
  const workOrderStatusCount = Math.max(1, plan.workOrderStatuses.length);
  const needsAlarms = plan.sources.includes("alarms") || plan.needsRepeatAnalysis;
  const needsWorkOrders = plan.sources.includes("work_orders") || plan.needsComplianceReview;
  const latestStatusLookup = plan.intent === "turbine_status" && plan.faultCodes.length === 0 && !plan.timeRange;
  const alarmExecutions = needsAlarms ? turbineCount * (latestStatusLookup ? 1 : faultCodeCount) : 0;
  const workOrderExecutions = needsWorkOrders ? turbineCount * faultCodeCount * workOrderStatusCount : 0;
  const documentExecutions = Number(plan.sources.includes("fault_manual")) + Number(plan.sources.includes("safety_policy"));

  return alarmExecutions + workOrderExecutions + documentExecutions;
}

function needsReplacementReview(question: string): boolean {
  return /更换|备件|单板|模块|作业条件|前置条件/.test(question);
}

function needsWorkOrderClosureReview(question: string, plan: SupportedQueryPlan): boolean {
  return /关闭要求|关闭|已完成|观察时间|观察.*分钟/.test(question) || plan.faultCodes.includes("24011");
}

function getRequiredSafetyPolicyClauseIds(question: string, plan: SupportedQueryPlan): string[] {
  const clauseIds: string[] = [];
  const requiresReplacementReview = needsReplacementReview(question);
  const requiresClosureReview = needsWorkOrderClosureReview(question, plan);

  if (/远程.*复位|强制复位/.test(question)) {
    clauseIds.push("4.1", "4.2");
  }
  if (plan.needsRepeatAnalysis) {
    clauseIds.push("3.1", "3.2", "3.3");
  }
  if (/优先级/.test(question) || plan.faultCodes.includes("24005")) {
    if (plan.faultCodes.includes("24005")) {
      clauseIds.push("2.1", "4.1");
    } else {
      clauseIds.push("2.2", "2.4");
    }
  }
  if (requiresReplacementReview) {
    clauseIds.push("5.1", "5.2", "7.1", "7.2", "7.3");
  }
  if (requiresClosureReview) {
    clauseIds.push("6.1", "6.3", "6.4", "6.5");
  }

  return unique(clauseIds);
}

function estimateEvidenceItems(question: string, plan: SupportedQueryPlan): number {
  const turbineCount = plan.turbineIds.length;
  const faultCodeCount = Math.max(1, plan.faultCodes.length);
  const workOrderStatusCount = Math.max(1, plan.workOrderStatuses.length);
  const needsAlarms = plan.sources.includes("alarms") || plan.needsRepeatAnalysis;
  const needsWorkOrders = plan.sources.includes("work_orders") || plan.needsComplianceReview;
  const latestStatusLookup = plan.intent === "turbine_status" && plan.faultCodes.length === 0 && !plan.timeRange;
  const alarmEvidenceItems = needsAlarms ? turbineCount * (latestStatusLookup ? 1 : faultCodeCount) : 0;
  const workOrderEvidenceItems = needsWorkOrders ? turbineCount * faultCodeCount * workOrderStatusCount : 0;
  const faultManualEvidenceItems = plan.sources.includes("fault_manual") ? 4 : 0;
  const safetyPolicyEvidenceItems = plan.sources.includes("safety_policy")
    ? Math.max(4, getRequiredSafetyPolicyClauseIds(question, plan).length)
    : 0;
  const repeatEvidenceItems = plan.needsRepeatAnalysis ? turbineCount * plan.faultCodes.length : 0;
  const priorityReviewNeeded = plan.needsRepeatAnalysis || plan.faultCodes.includes("24005");
  const derivedEvidencePerWorkOrderQuery = plan.needsComplianceReview
    ? Number(needsWorkOrderClosureReview(question, plan)) + Number(priorityReviewNeeded) + Number(needsReplacementReview(question))
    : 0;

  return (
    alarmEvidenceItems +
    workOrderEvidenceItems +
    faultManualEvidenceItems +
    safetyPolicyEvidenceItems +
    repeatEvidenceItems +
    workOrderEvidenceItems * derivedEvidencePerWorkOrderQuery
  );
}

interface EvidenceRetriever {
  retrieve(question: string, options?: HybridRetrieveOptions): Promise<HybridRetrieveResult>;
}

export interface ControlledEvidenceInput {
  question: string;
  plan: SupportedQueryPlan;
  repository: WindFarmRepository;
  retriever: EvidenceRetriever;
  onStep?: (step: EvidencePartData["executionSteps"][number]) => void;
}

export interface ControlledEvidenceResult extends EvidencePartData {
  toolExecutions: number;
}

export async function collectControlledEvidence({
  question,
  plan,
  repository,
  retriever,
  onStep,
}: ControlledEvidenceInput): Promise<ControlledEvidenceResult> {
  const evidence: Evidence[] = [];
  const executionSteps: EvidencePartData["executionSteps"] = [];
  const alarmEvidenceIds: string[] = [];
  const workOrdersByEvidenceId = new Map<string, Array<ReturnType<WindFarmRepository["findWorkOrders"]>[number]>>();
  const alarmRowsByPair = new Map<string, Array<{ occurred_at: string }>>();
  const repeatResultsByPair = new Map<string, ReturnType<typeof findRepeatFaultWindow>>();
  let evidenceNumber = 0;
  let toolExecutions = 0;

  if (estimateToolExecutions(plan) > maxToolExecutions) {
    throw new Error("查询范围超过受控 8 次上限，请缩小风机、故障代码或工单状态范围");
  }
  if (estimateEvidenceItems(question, plan) > maxEvidenceItems) {
    throw new Error("可追溯 Evidence 超过单轮 16 条上限，请缩小故障代码、数据源或问题范围");
  }

  const addStep = (label: EvidencePartData["executionSteps"][number]["label"], status: "done" | "degraded" = "done") => {
    if (!executionSteps.some((step) => step.label === label)) {
      const step = { label, status } as const;
      executionSteps.push(step);
      onStep?.(step);
    }
  };
  const recordToolExecution = () => {
    toolExecutions += 1;
    if (toolExecutions > maxToolExecutions) {
      throw new Error("受控查询超过单轮 8 次上限");
    }
  };
  const addEvidence = (item: Omit<Evidence, "id">): string => {
    if (evidence.length >= maxEvidenceItems) {
      throw new Error("可追溯 Evidence 超过单轮 16 条上限，请缩小故障代码、数据源或问题范围");
    }
    const id = `E${++evidenceNumber}`;
    evidence.push({ ...item, id });
    return id;
  };
  const requiredTurbines = () => {
    if (plan.turbineIds.length === 0) {
      throw new Error("当前问题需要明确的风机编号，无法安全查询数据库");
    }
    return plan.turbineIds;
  };

  const needsAlarms = plan.sources.includes("alarms") || plan.needsRepeatAnalysis;
  if (needsAlarms) {
    if (plan.needsRepeatAnalysis && !plan.sources.includes("alarms")) {
      throw new Error("重复故障分析必须包含告警记录来源");
    }
    for (const turbineId of requiredTurbines()) {
      if (plan.intent === "turbine_status" && plan.faultCodes.length === 0 && !plan.timeRange) {
        recordToolExecution();
        const latestAlarm = repository.getLatestAlarm(turbineId);
        const id = addEvidence({
          kind: "database",
          source: "alarm_records",
          location: "按 occurred_at DESC, alarm_id DESC 的最新告警记录",
          queryParameters: { turbineId, queryType: "getLatestAlarm" },
          content: latestAlarm ?? { message: "未查询到该风机的告警记录" },
        });
        alarmEvidenceIds.push(id);
        if (latestAlarm) {
          alarmRowsByPair.set(`${turbineId}:${latestAlarm.fault_code}`, [latestAlarm]);
        }
        continue;
      }

      const faultCodes = plan.faultCodes.length === 0 ? [undefined] : plan.faultCodes;
      for (const faultCode of faultCodes) {
        recordToolExecution();
        const rows = repository.listAlarms({
          turbineId,
          faultCode,
          from: plan.timeRange?.from,
          to: plan.timeRange?.to,
          limit: plan.queryLimit,
        });
        const id = addEvidence({
          kind: "database",
          source: "alarm_records",
          location: "受控告警列表查询（闭区间）",
          queryParameters: {
            turbineId,
            faultCode: faultCode ?? null,
            from: plan.timeRange?.from ?? null,
            to: plan.timeRange?.to ?? null,
          },
          content: rows.length > 0 ? rows : { message: "未查询到匹配告警记录" },
        });
        alarmEvidenceIds.push(id);
        if (faultCode) {
          alarmRowsByPair.set(`${turbineId}:${faultCode}`, rows);
        }
      }
    }
    addStep("已查询运行告警记录");
  }

  const needsWorkOrders = plan.sources.includes("work_orders") || plan.needsComplianceReview;
  if (needsWorkOrders) {
    if (plan.needsComplianceReview && !plan.sources.includes("work_orders")) {
      throw new Error("工单合规性复核必须包含维检工单来源");
    }
    const statuses = plan.workOrderStatuses.length === 0 ? [undefined] : plan.workOrderStatuses;
    for (const turbineId of requiredTurbines()) {
      const faultCodes = plan.faultCodes.length === 0 ? [undefined] : plan.faultCodes;
      for (const faultCode of faultCodes) {
        for (const status of statuses) {
          recordToolExecution();
          const rows = repository.findWorkOrders({ turbineId, faultCode, status, limit: plan.queryLimit });
          const id = addEvidence({
            kind: "database",
            source: "maintenance_records",
            location: "按 turbine_id + fault_code 关联的受控工单查询",
            queryParameters: { turbineId, faultCode: faultCode ?? null, status: status ?? null },
            content: rows.length > 0 ? rows : { message: "未查询到匹配维检工单" },
          });
          if (rows.length > 0) {
            workOrdersByEvidenceId.set(id, rows);
          }
        }
      }
    }
    addStep("已查询维检工单记录");
  }

  const documentRequests: Array<{
    documentType: "fault_manual" | "safety_policy";
    stepLabel: EvidencePartData["executionSteps"][number]["label"];
    requiredClauseIds?: string[];
  }> = [];
  if (plan.sources.includes("fault_manual")) {
    documentRequests.push({ documentType: "fault_manual", stepLabel: "已检索故障处理手册" });
  }
  if (plan.sources.includes("safety_policy")) {
    documentRequests.push({
      documentType: "safety_policy",
      stepLabel: "已检索安全管理规程",
      requiredClauseIds: getRequiredSafetyPolicyClauseIds(question, plan),
    });
  }
  for (const request of documentRequests) {
    recordToolExecution();
    const maxResults = Math.max(4, request.requiredClauseIds?.length ?? 0);
    const retrieved = await retriever.retrieve(question, {
      maxResults,
      documentTypes: [request.documentType],
      requiredClauseIds: request.requiredClauseIds,
    });
    for (const chunk of retrieved.chunks) {
      addEvidence({
        kind: "document",
        source: chunk.metadata.sourceFile,
        location: chunk.metadata.headingPath.join(" > "),
        queryParameters: {
          retrieval: retrieved.exactMatches.includes(chunk.metadata.chunkId) ? "exact+hybrid" : "hybrid",
          chunkId: chunk.metadata.chunkId,
          faultCode: chunk.metadata.faultCode ?? null,
          clauseId: chunk.metadata.clauseId ?? null,
        },
        content: chunk.content,
      });
    }
    addStep(request.stepLabel, retrieved.degraded ? "degraded" : "done");
    if (retrieved.degraded) {
      addStep("文档语义检索已降级为关键词检索", "degraded");
    }
  }

  if (plan.needsRepeatAnalysis) {
    for (const turbineId of plan.turbineIds) {
      for (const faultCode of plan.faultCodes) {
        const pair = `${turbineId}:${faultCode}`;
        const result = findRepeatFaultWindow(alarmRowsByPair.get(pair) ?? []);
        repeatResultsByPair.set(pair, result);
        addEvidence({
          kind: "derived",
          source: "重复故障计算",
          location: "连续 24 小时滑动窗口；阈值为 3 次且包含恰好 24 小时边界",
          content: { turbineId, faultCode, ...result },
          derivedFrom: alarmEvidenceIds,
        });
      }
    }
    addStep("已完成重复故障分析");
  }

  if (plan.needsComplianceReview) {
    const requiresClosureReview = needsWorkOrderClosureReview(question, plan);
    const requiresReplacementReview = needsReplacementReview(question);
    for (const [workOrderEvidenceId, groupedWorkOrders] of workOrdersByEvidenceId) {
      if (requiresClosureReview) {
        const assessments = groupedWorkOrders.map((workOrder) => ({
          workOrderId: workOrder.work_order_id,
          ...assessWorkOrderClosure(workOrder),
        }));
        addEvidence({
          kind: "derived",
          source: "工单关闭合规性复核",
          location: "依据规程第 6.1～6.5 条的确定性记录与观察时间核验",
          content: assessments.length === 1 ? assessments[0]! : { assessments },
          derivedFrom: [workOrderEvidenceId],
        });
      }

      const priorityAssessments = groupedWorkOrders
        .map((workOrder) => ({
          workOrderId: workOrder.work_order_id,
          ...assessPriorityReview(workOrder, {
            isRepeatFault: repeatResultsByPair.get(`${workOrder.turbine_id}:${workOrder.fault_code}`)?.isRepeatFault ?? false,
          }),
        }))
        .filter((assessment) => assessment.requiredPriority !== null);
      if (priorityAssessments.length > 0) {
        addEvidence({
          kind: "derived",
          source: "工单优先级复核",
          location: "依据规程第 2.1～2.4 条及第 3.2 条的确定性优先级核验",
          content: priorityAssessments.length === 1 ? priorityAssessments[0]! : { assessments: priorityAssessments },
          derivedFrom: [workOrderEvidenceId],
        });
      }

      if (requiresReplacementReview) {
        const assessments = groupedWorkOrders.map((workOrder) => ({
          workOrderId: workOrder.work_order_id,
          ...assessReplacementReadiness(workOrder),
        }));
        addEvidence({
          kind: "derived",
          source: "立即更换条件核验",
          location: "依据规程第 5.1～5.2 条、第 7.1～7.3 条的备件和现场条件核验",
          content: assessments.length === 1 ? assessments[0]! : { assessments },
          derivedFrom: [workOrderEvidenceId],
        });
      }
    }
    addStep("已完成合规规则核验");
  }

  return { evidence, claims: buildVerifiedClaims(evidence), executionSteps, invalidEvidenceIds: [], toolExecutions };
}
