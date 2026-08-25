import { describe, expect, it } from "vitest";

import { createWindFarmRepository, closeDatabase, openReadOnlyDatabase } from "@/lib/data/repository";
import { assessPriorityReview, assessWorkOrderClosure, findRepeatFaultWindow } from "@/lib/agent/business-rules";

describe("重复故障规则", () => {
  it("将 T03/24002 在连续 24 小时内的四次告警判为重复故障", () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const alarms = repository.listAlarms({
        turbineId: "T03",
        faultCode: "24002",
        from: "2026-07-18 08:00:00",
        to: "2026-07-19 08:00:00",
        limit: 20,
      });
      const result = findRepeatFaultWindow(alarms);

      expect(result.maxOccurrences).toBe(4);
      expect(result.isRepeatFault).toBe(true);
    } finally {
      closeDatabase(database);
    }
  });

  it("将 T07/24012 的两次告警判为未达到重复故障阈值", () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const alarms = repository.listAlarms({
        turbineId: "T07",
        faultCode: "24012",
        from: "2026-07-18 08:00:00",
        to: "2026-07-19 08:00:00",
        limit: 20,
      });
      const result = findRepeatFaultWindow(alarms);

      expect(result.maxOccurrences).toBe(2);
      expect(result.isRepeatFault).toBe(false);
    } finally {
      closeDatabase(database);
    }
  });

  it("将恰好相隔 24 小时的第三次告警计入同一窗口", () => {
    const result = findRepeatFaultWindow([
      { occurred_at: "2026-07-18 08:00:00" },
      { occurred_at: "2026-07-18 20:00:00" },
      { occurred_at: "2026-07-19 08:00:00" },
    ]);

    expect(result.maxOccurrences).toBe(3);
    expect(result.isRepeatFault).toBe(true);
  });
});

describe("工单关闭合规规则", () => {
  it("不会把否定性的处理备注判定为已完成处理和复检", () => {
    const result = assessWorkOrderClosure({
      work_order_id: "WO-TEST-1",
      turbine_id: "T01",
      fault_code: "24001",
      priority: "NORMAL",
      status: "COMPLETED",
      created_at: "2026-07-01 00:00:00",
      resolution_note: "原因未查明，未处理，未复检，未更换部件。",
      observation_minutes: 120,
      required_part: null,
      part_available: null,
    });

    expect(result.status).toBe("non_compliant");
    expect(result.missingItems).toEqual(
      expect.arrayContaining(["实际故障原因", "处理措施", "完整复检结果"]),
    );
  });

  it("不将 T09/24011 的已完成状态误判为合规", () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const workOrder = repository.findWorkOrders({
        turbineId: "T09",
        faultCode: "24011",
        limit: 20,
      })[0];
      expect(workOrder).toBeDefined();

      const result = assessWorkOrderClosure(workOrder!);

      expect(result.status).toBe("non_compliant");
      expect(result.missingItems).toContain("开机设置、参数恢复和固化情况");
      expect(result.missingItems).toContain("故障复位结果与参数恢复验证");
      expect(result.missingItems).toContain("完整复检结果");
      expect(result.missingItems).toEqual(
        expect.arrayContaining(["更换部件或未更换说明", "参数恢复或固化情况", "故障复位结果"]),
      );
      expect(result.observationRequirement).toMatchObject({ requiredMinutes: 120, actualMinutes: 15 });
    } finally {
      closeDatabase(database);
    }
  });
});

describe("工单优先级规则", () => {
  it("将重复故障的 NORMAL 工单判定为应升级到 HIGH", () => {
    const result = assessPriorityReview(
      {
        work_order_id: "WO-260703",
        turbine_id: "T03",
        fault_code: "24002",
        priority: "NORMAL",
        status: "OPEN",
        created_at: "2026-07-18 08:25:00",
        resolution_note: null,
        observation_minutes: null,
        required_part: "通讯模块",
        part_available: 1,
      },
      { isRepeatFault: true },
    );

    expect(result).toMatchObject({ status: "non_compliant", currentPriority: "NORMAL", requiredPriority: "HIGH" });
  });

  it("将急停故障的 NORMAL 工单判定为应升级到 EMERGENCY", () => {
    const result = assessPriorityReview(
      {
        work_order_id: "WO-260705",
        turbine_id: "T05",
        fault_code: "24005",
        priority: "NORMAL",
        status: "PLANNED",
        created_at: "2026-07-19 10:25:00",
        resolution_note: "待安排现场检查急停回路。",
        observation_minutes: null,
        required_part: null,
        part_available: null,
      },
      { isRepeatFault: false },
    );

    expect(result).toMatchObject({ status: "non_compliant", currentPriority: "NORMAL", requiredPriority: "EMERGENCY" });
  });
});
