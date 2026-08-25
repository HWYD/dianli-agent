import type { Evidence, VerifiedClaim } from "./schemas";

type ClaimStatus = VerifiedClaim["status"];
const maxVerifiedClaims = 16;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readAssessments(value: unknown): { assessments: Record<string, unknown>[]; isBatch: boolean } {
  const record = asRecord(value);
  if (!record) {
    return { assessments: [], isBatch: false };
  }

  if (Array.isArray(record.assessments)) {
    return {
      assessments: record.assessments.map(asRecord).filter((assessment): assessment is Record<string, unknown> => assessment !== null),
      isBatch: true,
    };
  }

  return { assessments: [record], isBatch: false };
}

function getClauseId(evidence: Evidence): string | null {
  const clauseId = evidence.queryParameters?.clauseId;
  return typeof clauseId === "string" ? clauseId : null;
}

export function buildVerifiedClaims(evidence: Evidence[]): VerifiedClaim[] {
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const claims: VerifiedClaim[] = [];
  let claimNumber = 0;

  const addClaim = (status: ClaimStatus, statement: string, claimEvidenceIds: string[]) => {
    const supportedEvidenceIds = [...new Set(claimEvidenceIds)].filter((id) => evidenceIds.has(id));
    if (supportedEvidenceIds.length === 0 || claims.length >= maxVerifiedClaims || claims.some((claim) => claim.statement === statement)) {
      return;
    }
    claims.push({ id: `C${++claimNumber}`, status, statement, evidenceIds: supportedEvidenceIds });
  };

  for (const item of evidence) {
    if (item.kind === "document" && item.source === "海上风电机组检修作业与安全管理规程.md" && getClauseId(item) === "4.1") {
      addClaim(
        "prohibited",
        "规程第 4.1 条规定：急停或安全链、24 小时内同机同码重复故障、要求断电检查或更换单板、无法确认安全状态、涉及母线电压或功率回路时，禁止远程强制复位或继续依赖反复远程复位。",
        [item.id],
      );
      continue;
    }

    if (item.kind !== "derived") {
      continue;
    }

    const { assessments, isBatch } = readAssessments(item.content);
    if (assessments.length === 0) {
      continue;
    }
    const claimEvidenceIds = [item.id, ...(item.derivedFrom ?? [])];

    if (item.source === "重复故障计算") {
      const content = assessments[0]!;
      const turbineId = readString(content, "turbineId");
      const faultCode = readString(content, "faultCode");
      const maxOccurrences = readNumber(content, "maxOccurrences");
      const isRepeatFault = readBoolean(content, "isRepeatFault");
      if (turbineId && faultCode && maxOccurrences !== null && isRepeatFault !== null) {
        addClaim(
          "confirmed",
          `${turbineId}/${faultCode} 在任意连续 24 小时内最多发生 ${maxOccurrences} 次，${isRepeatFault ? "属于重复故障。" : "未达到重复故障标准。"}`,
          claimEvidenceIds,
        );
      }
      continue;
    }

    if (item.source === "工单优先级复核") {
      if (isBatch) {
        const nonCompliantCount = assessments.filter((assessment) => readString(assessment, "status") === "non_compliant").length;
        const requiredCount = assessments.filter((assessment) => readString(assessment, "requiredPriority") !== null).length;
        if (requiredCount > 0) {
          addClaim(
            nonCompliantCount > 0 ? "non_compliant" : "confirmed",
            nonCompliantCount > 0
              ? `共 ${requiredCount} 张工单需要按规则提升优先级，其中 ${nonCompliantCount} 张未达到对应优先级要求。`
              : `共 ${requiredCount} 张需要提升优先级的工单均满足对应优先级要求。`,
            claimEvidenceIds,
          );
        }
        continue;
      }

      const content = assessments[0]!;
      const workOrderId = readString(content, "workOrderId");
      const currentPriority = readString(content, "currentPriority");
      const requiredPriority = readString(content, "requiredPriority");
      const status = readString(content, "status");
      if (workOrderId && currentPriority && requiredPriority && status) {
        addClaim(
          status === "compliant" ? "confirmed" : "non_compliant",
          status === "compliant"
            ? `工单 ${workOrderId} 当前为 ${currentPriority}，满足至少为 ${requiredPriority} 的优先级要求。`
            : `工单 ${workOrderId} 当前为 ${currentPriority}，未达到应至少为 ${requiredPriority} 的优先级要求。`,
          claimEvidenceIds,
        );
      }
      continue;
    }

    if (item.source === "工单关闭合规性复核") {
      if (isBatch) {
        const nonCompliantAssessments = assessments.filter((assessment) => readString(assessment, "status") === "non_compliant");
        if (nonCompliantAssessments.length > 0) {
          addClaim(
            "non_compliant",
            `共 ${nonCompliantAssessments.length} 张工单的关闭记录不合规；详细缺项请查看对应 Evidence。`,
            claimEvidenceIds,
          );
        }
        continue;
      }

      const content = assessments[0]!;
      const workOrderId = readString(content, "workOrderId");
      const status = readString(content, "status");
      const missingItems = readStringArray(content, "missingItems");
      if (workOrderId && status === "non_compliant") {
        addClaim(
          "non_compliant",
          `工单 ${workOrderId} 的关闭记录不合规：缺少${missingItems.join("、")}。`,
          claimEvidenceIds,
        );
      }
      continue;
    }

    if (item.source === "立即更换条件核验") {
      if (isBatch) {
        const cannotConfirmCount = assessments.filter(
          (assessment) => readBoolean(assessment, "canConfirmImmediateReplacement") === false,
        ).length;
        if (cannotConfirmCount > 0) {
          addClaim(
            "insufficient_evidence",
            `共 ${cannotConfirmCount} 张工单当前不能确认具备立即更换条件，仍需核实备件和现场安全条件。`,
            claimEvidenceIds,
          );
        }
        continue;
      }

      const content = assessments[0]!;
      const workOrderId = readString(content, "workOrderId");
      const partAvailable = readBoolean(content, "partAvailable");
      const canConfirmImmediateReplacement = readBoolean(content, "canConfirmImmediateReplacement");
      const unconfirmedConditions = readStringArray(content, "unconfirmedConditions");
      if (workOrderId && canConfirmImmediateReplacement === false) {
        const partStatement = partAvailable === false ? "所需备件当前不可用" : "现场作业条件尚未齐备";
        const unconfirmedStatement = unconfirmedConditions.length > 0
          ? `，且仍缺少${unconfirmedConditions.join("、")}等现场确认`
          : "";
        addClaim(
          "insufficient_evidence",
          `工单 ${workOrderId} 当前不能确认具备立即更换条件；${partStatement}${unconfirmedStatement}。`,
          claimEvidenceIds,
        );
      }
    }
  }

  return claims;
}
