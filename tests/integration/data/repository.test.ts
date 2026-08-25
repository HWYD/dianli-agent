import { describe, expect, it } from "vitest";

import { closeDatabase, createWindFarmRepository, openReadOnlyDatabase } from "@/lib/data/repository";

describe("风场 SQLite 受控查询", () => {
  it("按最新告警时间和记录号返回 T06 的状态", () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const alarm = repository.getLatestAlarm("T06");

      expect(alarm).toMatchObject({
        turbine_id: "T06",
        turbine_model: "OWT-5.0A",
        turbine_status: "STOPPED",
        occurred_at: "2026-07-18 09:10:00",
      });
    } finally {
      closeDatabase(database);
    }
  });

  it("以闭区间返回 T04 在指定时间范围内的两条告警", () => {
    const database = openReadOnlyDatabase();
    const repository = createWindFarmRepository(database);

    try {
      const alarms = repository.listAlarms({
        turbineId: "T04",
        from: "2026-07-11 02:40:00",
        to: "2026-07-14 22:05:00",
        limit: 20,
      });

      expect(alarms).toHaveLength(2);
      expect(alarms.map((alarm) => alarm.fault_code)).toEqual(["24001", "24013"]);
      expect(alarms.map((alarm) => alarm.alarm_status)).toEqual(["CLEARED", "CLEARED"]);
    } finally {
      closeDatabase(database);
    }
  });

  it("以只读方式打开题目数据库", () => {
    const database = openReadOnlyDatabase();

    try {
      expect(() => database.prepare("CREATE TABLE should_not_exist (id INTEGER)").run()).toThrow();
    } finally {
      closeDatabase(database);
    }
  });
});
