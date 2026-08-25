import { describe, expect, it } from "vitest";

import type { Evidence } from "@/lib/agent/schemas";
import { buildVerifiedClaims } from "@/lib/agent/claims";

describe("服务端核验结论", () => {
  it("从重复故障和优先级派生证据生成可追溯的硬结论", () => {
    const evidence: Evidence[] = [
      {
        id: "E1",
        kind: "database",
        source: "alarm_records",
        location: "受控查询",
        content: [],
      },
      {
        id: "E2",
        kind: "derived",
        source: "重复故障计算",
        location: "24 小时窗口",
        content: { turbineId: "T03", faultCode: "24002", maxOccurrences: 4, isRepeatFault: true },
        derivedFrom: ["E1"],
      },
      {
        id: "E3",
        kind: "derived",
        source: "工单优先级复核",
        location: "规程第 3.2 条",
        content: {
          workOrderId: "WO-260703",
          status: "non_compliant",
          currentPriority: "NORMAL",
          requiredPriority: "HIGH",
        },
        derivedFrom: ["E1"],
      },
    ];

    expect(buildVerifiedClaims(evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "confirmed",
          statement: "T03/24002 在任意连续 24 小时内最多发生 4 次，属于重复故障。",
          evidenceIds: ["E2", "E1"],
        }),
        expect.objectContaining({
          status: "non_compliant",
          statement: "工单 WO-260703 当前为 NORMAL，未达到应至少为 HIGH 的优先级要求。",
          evidenceIds: ["E3", "E1"],
        }),
      ]),
    );
  });

  it("将备件不可用和关闭不合规作为独立结论，而不是让模型从原始记录中自行推断", () => {
    const evidence: Evidence[] = [
      {
        id: "E1",
        kind: "derived",
        source: "立即更换条件核验",
        location: "规程第 5.1 条",
        content: {
          workOrderId: "WO-260707",
          partAvailable: false,
          canConfirmImmediateReplacement: false,
          unconfirmedConditions: ["主电源隔离", "挂牌上锁"],
        },
        derivedFrom: ["E9"],
      },
      {
        id: "E2",
        kind: "derived",
        source: "工单关闭合规性复核",
        location: "规程第 6.1 条",
        content: {
          workOrderId: "WO-260708",
          status: "non_compliant",
          missingItems: ["完整复检结果", "不少于 120 分钟的处理后观察时间"],
        },
        derivedFrom: ["E8"],
      },
    ];

    expect(buildVerifiedClaims(evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "insufficient_evidence",
          statement: "工单 WO-260707 当前不能确认具备立即更换条件；所需备件当前不可用，且仍缺少主电源隔离、挂牌上锁等现场确认。",
        }),
        expect.objectContaining({
          status: "non_compliant",
          statement: "工单 WO-260708 的关闭记录不合规：缺少完整复检结果、不少于 120 分钟的处理后观察时间。",
        }),
      ]),
    );
  });

  it("为纯规程的远程复位问题生成规则结论", () => {
    const evidence: Evidence[] = [
      {
        id: "E1",
        kind: "document",
        source: "海上风电机组检修作业与安全管理规程.md",
        location: "第四章 > 第 4.1 条 禁止情形",
        queryParameters: { clauseId: "4.1" },
        content: "规程正文",
      },
    ];

    expect(buildVerifiedClaims(evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "prohibited",
          evidenceIds: ["E1"],
          statement: expect.stringContaining("禁止远程强制复位"),
        }),
      ]),
    );
  });
});
