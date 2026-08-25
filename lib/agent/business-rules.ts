import type { MaintenanceRecord } from "../data/repository";

const repeatFaultThreshold = 3;
const twentyFourHours = 24 * 60 * 60 * 1000;

export interface AlarmOccurrence {
  occurred_at: string;
}

export interface RepeatFaultResult {
  maxOccurrences: number;
  isRepeatFault: boolean;
  windowStart?: string;
  windowEnd?: string;
}

function toTimestamp(value: string): number {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

export function findRepeatFaultWindow(alarms: AlarmOccurrence[]): RepeatFaultResult {
  const ordered = [...alarms].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
  let bestStart = 0;
  let bestEnd = -1;
  let left = 0;

  for (let right = 0; right < ordered.length; right += 1) {
    while (
      left <= right &&
      toTimestamp(ordered[right]!.occurred_at) - toTimestamp(ordered[left]!.occurred_at) > twentyFourHours
    ) {
      left += 1;
    }

    if (right - left > bestEnd - bestStart) {
      bestStart = left;
      bestEnd = right;
    }
  }

  const maxOccurrences = bestEnd < bestStart ? 0 : bestEnd - bestStart + 1;
  return {
    maxOccurrences,
    isRepeatFault: maxOccurrences >= repeatFaultThreshold,
    windowStart: ordered[bestStart]?.occurred_at,
    windowEnd: ordered[bestEnd]?.occurred_at,
  };
}

export interface WorkOrderClosureAssessment {
  status: "compliant" | "non_compliant" | "insufficient_evidence";
  missingItems: string[];
  observationRequirement?: {
    requiredMinutes: number;
    actualMinutes: number | null;
    met: boolean;
  };
}

const enhancedClosureFaultCodes = new Set(["24002", "24010", "24011"]);

function includesAny(note: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(note));
}

function hasAffirmativeEvidence(note: string, positivePatterns: RegExp[], negativePatterns: RegExp[]): boolean {
  return !includesAny(note, negativePatterns) && includesAny(note, positivePatterns);
}

export function assessWorkOrderClosure(workOrder: MaintenanceRecord): WorkOrderClosureAssessment {
  if (workOrder.status !== "COMPLETED") {
    return { status: "insufficient_evidence", missingItems: ["工单尚未处于 COMPLETED 状态"] };
  }

  const note = workOrder.resolution_note ?? "";
  const missingItems: string[] = [];

  if (!hasAffirmativeEvidence(note, [/原因/, /升级/, /读写/, /异常/, /故障定位/], [/原因未查明/, /未查明原因/, /原因不明/])) {
    missingItems.push("实际故障原因");
  }

  if (!hasAffirmativeEvidence(note, [/处理/, /更换/, /修复/, /设置/, /恢复/], [/未处理/, /未更换/, /未修复/, /未设置/, /未恢复/])) {
    missingItems.push("处理措施");
  }

  if (!hasAffirmativeEvidence(note, [/复检/, /验证/, /测试/], [/未复检/, /未验证/, /未测试/])) {
    missingItems.push("完整复检结果");
  }

  if (!includesAny(note, [/(更换|未更换|无需更换|不需要更换).{0,12}(部件|备件)/, /(部件|备件).{0,12}(更换|未更换|无需)/])) {
    missingItems.push("更换部件或未更换说明");
  }

  if (!includesAny(note, [/参数(恢复|固化|不适用)/, /(无需|不涉及|不适用).{0,8}参数/])) {
    missingItems.push("参数恢复或固化情况");
  }

  if (!includesAny(note, [/复位(结果|成功|完成)/, /(无需|不需要|不适用).{0,8}复位/])) {
    missingItems.push("故障复位结果");
  }

  if (workOrder.observation_minutes === null) {
    missingItems.push("处理后的观察时间");
  }

  if (workOrder.fault_code === "24011") {
    if (!includesAny(note, [/开机设置/, /参数恢复/, /参数固化/, /固化参数/])) {
      missingItems.push("开机设置、参数恢复和固化情况");
    }
    if (!includesAny(note, [/故障复位/, /复位结果/]) || !includesAny(note, [/参数恢复验证/, /重启后.*参数/, /参数.*重启/])) {
      missingItems.push("故障复位结果与参数恢复验证");
    }
  }

  let observationRequirement: WorkOrderClosureAssessment["observationRequirement"];
  if (enhancedClosureFaultCodes.has(workOrder.fault_code)) {
    const actualMinutes = workOrder.observation_minutes;
    observationRequirement = {
      requiredMinutes: 120,
      actualMinutes,
      met: actualMinutes !== null && actualMinutes >= 120,
    };
    if (!observationRequirement.met) {
      missingItems.push("不少于 120 分钟的处理后观察时间");
    }
  }

  return {
    status: missingItems.length === 0 ? "compliant" : "non_compliant",
    missingItems,
    observationRequirement,
  };
}

export interface ReplacementReadiness {
  partAvailable: boolean | null;
  canConfirmImmediateReplacement: false;
  unconfirmedConditions: string[];
}

export interface PriorityAssessment {
  status: "compliant" | "non_compliant" | "insufficient_evidence";
  currentPriority: MaintenanceRecord["priority"];
  requiredPriority: "HIGH" | "EMERGENCY" | null;
  reasons: string[];
}

const priorityRank: Record<MaintenanceRecord["priority"], number> = {
  NORMAL: 1,
  HIGH: 2,
  EMERGENCY: 3,
};

export function assessPriorityReview(
  workOrder: MaintenanceRecord,
  input: { isRepeatFault: boolean },
): PriorityAssessment {
  const requiredPriority = workOrder.fault_code === "24005"
    ? "EMERGENCY"
    : input.isRepeatFault
      ? "HIGH"
      : null;

  if (requiredPriority === null) {
    return {
      status: "insufficient_evidence",
      currentPriority: workOrder.priority,
      requiredPriority,
      reasons: ["当前工单不满足已实现的优先级升级规则"],
    };
  }

  const isCompliant = priorityRank[workOrder.priority] >= priorityRank[requiredPriority];
  return {
    status: isCompliant ? "compliant" : "non_compliant",
    currentPriority: workOrder.priority,
    requiredPriority,
    reasons: [
      workOrder.fault_code === "24005"
        ? "急停故障工单应按 EMERGENCY 优先级处置"
        : "24 小时内重复故障工单应至少按 HIGH 优先级处置",
    ],
  };
}

export function assessReplacementReadiness(workOrder: MaintenanceRecord): ReplacementReadiness {
  return {
    partAvailable: workOrder.part_available === null ? null : workOrder.part_available === 1,
    canConfirmImmediateReplacement: false,
    unconfirmedConditions: [
      "已退出远程控制",
      "主电源隔离、挂牌上锁和验电",
      "母线电压降至约 20 V 的安全范围",
      "相关开关断开状态",
      "现场人员资质、海况、天气与作业环境",
    ],
  };
}
