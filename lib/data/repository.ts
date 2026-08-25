import Database from "better-sqlite3";
import path from "node:path";
import { z } from "zod";

import { faultCodeSchema, timestampSchema, turbineIdSchema } from "../agent/schemas";

const defaultDatabasePath = path.join(process.cwd(), "docs", "require", "海上风电维检.db");

export type ReadOnlyDatabase = Database.Database;

export interface AlarmRecord {
  alarm_id: number;
  turbine_id: string;
  turbine_model: string;
  turbine_status: "RUNNING" | "STOPPED" | "MAINTENANCE" | "LIMITED";
  fault_code: string;
  fault_name: string;
  severity: "INFO" | "WARNING" | "MAJOR" | "CRITICAL";
  occurred_at: string;
  alarm_status: "ACTIVE" | "CLEARED";
}

export interface MaintenanceRecord {
  work_order_id: string;
  turbine_id: string;
  fault_code: string;
  priority: "NORMAL" | "HIGH" | "EMERGENCY";
  status: "OPEN" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  created_at: string;
  resolution_note: string | null;
  observation_minutes: number | null;
  required_part: string | null;
  part_available: 0 | 1 | null;
}

const listAlarmsInputSchema = z
  .object({
    turbineId: turbineIdSchema,
    faultCode: faultCodeSchema.optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    limit: z.number().int().min(1).max(20).default(20),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "时间范围起点不能晚于终点",
  });

const findWorkOrdersInputSchema = z.object({
  turbineId: turbineIdSchema,
  faultCode: faultCodeSchema.optional(),
  status: z.enum(["OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export function openReadOnlyDatabase(databasePath = process.env.SQLITE_PATH ?? defaultDatabasePath): ReadOnlyDatabase {
  const resolvedPath = path.resolve(databasePath);
  const database = new Database(resolvedPath, { fileMustExist: true, readonly: true });
  database.pragma("query_only = ON");
  return database;
}

export function closeDatabase(database: ReadOnlyDatabase): void {
  if (database.open) {
    database.close();
  }
}

export function createWindFarmRepository(database: ReadOnlyDatabase) {
  const getLatestAlarmStatement = database.prepare<
    { turbineId: string },
    AlarmRecord
  >(`
    SELECT alarm_id, turbine_id, turbine_model, turbine_status, fault_code, fault_name,
           severity, occurred_at, alarm_status
    FROM alarm_records
    WHERE turbine_id = @turbineId
    ORDER BY occurred_at DESC, alarm_id DESC
    LIMIT 1
  `);

  const listAlarmsStatement = database.prepare<
    { turbineId: string; faultCode: string | null; from: string | null; to: string | null; limit: number },
    AlarmRecord
  >(`
    SELECT alarm_id, turbine_id, turbine_model, turbine_status, fault_code, fault_name,
           severity, occurred_at, alarm_status
    FROM alarm_records
    WHERE turbine_id = @turbineId
      AND (@faultCode IS NULL OR fault_code = @faultCode)
      AND (@from IS NULL OR occurred_at >= @from)
      AND (@to IS NULL OR occurred_at <= @to)
    ORDER BY occurred_at ASC, alarm_id ASC
    LIMIT @limit
  `);

  const countAlarmsStatement = database.prepare<
    { turbineId: string; faultCode: string; from: string; to: string },
    { total: number }
  >(`
    SELECT COUNT(*) AS total
    FROM alarm_records
    WHERE turbine_id = @turbineId
      AND fault_code = @faultCode
      AND occurred_at >= @from
      AND occurred_at <= @to
  `);

  const findWorkOrdersStatement = database.prepare<
    { turbineId: string; faultCode: string | null; status: string | null; limit: number },
    MaintenanceRecord
  >(`
    SELECT work_order_id, turbine_id, fault_code, priority, status, created_at, resolution_note,
           observation_minutes, required_part, part_available
    FROM maintenance_records
    WHERE turbine_id = @turbineId
      AND (@faultCode IS NULL OR fault_code = @faultCode)
      AND (@status IS NULL OR status = @status)
    ORDER BY created_at DESC, work_order_id DESC
    LIMIT @limit
  `);

  return {
    getLatestAlarm(turbineId: string): AlarmRecord | undefined {
      return getLatestAlarmStatement.get({ turbineId: turbineIdSchema.parse(turbineId) });
    },

    listAlarms(input: z.input<typeof listAlarmsInputSchema>): AlarmRecord[] {
      const parsed = listAlarmsInputSchema.parse(input);
      return listAlarmsStatement.all({
        turbineId: parsed.turbineId,
        faultCode: parsed.faultCode ?? null,
        from: parsed.from ?? null,
        to: parsed.to ?? null,
        limit: parsed.limit,
      });
    },

    countAlarms(input: {
      turbineId: string;
      faultCode: string;
      from: string;
      to: string;
    }): number {
      const parsed = listAlarmsInputSchema
        .pick({ turbineId: true, faultCode: true, from: true, to: true })
        .required()
        .parse(input);
      return countAlarmsStatement.get(parsed)?.total ?? 0;
    },

    findWorkOrders(input: z.input<typeof findWorkOrdersInputSchema>): MaintenanceRecord[] {
      const parsed = findWorkOrdersInputSchema.parse(input);
      return findWorkOrdersStatement.all({
        turbineId: parsed.turbineId,
        faultCode: parsed.faultCode ?? null,
        status: parsed.status ?? null,
        limit: parsed.limit,
      });
    },
  };
}

export type WindFarmRepository = ReturnType<typeof createWindFarmRepository>;
