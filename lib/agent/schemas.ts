import { z } from "zod";

export const userQuestionSchema = z.string().trim().min(1).max(1000);

export const turbineIdSchema = z.string().regex(/^T0[1-9]$/, "风机编号必须为 T01～T09");
export const faultCodeSchema = z.string().regex(/^24\d{3}$/, "故障代码必须为 24xxx");
export const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "时间必须为 YYYY-MM-DD HH:MM:SS");

const sourceSchema = z.enum(["alarms", "work_orders", "fault_manual", "safety_policy"]);
const workOrderStatusSchema = z.enum(["OPEN", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

export const supportedQueryPlanSchema = z
  .object({
    intent: z.enum([
      "turbine_status",
      "alarm_query",
      "work_order_query",
      "fault_guidance",
      "policy_lookup",
      "compliance_review",
      "composite",
    ]),
    turbineIds: z.array(turbineIdSchema).max(3),
    faultCodes: z.array(faultCodeSchema).max(3),
    sources: z.array(sourceSchema).min(1).max(4),
    timeRange: z
      .object({
        from: timestampSchema.optional(),
        to: timestampSchema.optional(),
      })
      .optional()
      .refine(
        (range) => !range?.from || !range.to || range.from <= range.to,
        "时间范围起点不能晚于终点",
      ),
    workOrderStatuses: z.array(workOrderStatusSchema).max(5).default([]),
    needsRepeatAnalysis: z.boolean(),
    needsComplianceReview: z.boolean(),
    queryLimit: z.number().int().min(1).max(20).default(20),
  })
  .strict();

export const unsupportedQueryPlanSchema = z
  .object({
    intent: z.literal("unsupported"),
    turbineIds: z.array(turbineIdSchema).length(0),
    faultCodes: z.array(faultCodeSchema).length(0),
    sources: z.array(sourceSchema).length(0),
    workOrderStatuses: z.array(workOrderStatusSchema).length(0),
    needsRepeatAnalysis: z.literal(false),
    needsComplianceReview: z.literal(false),
    queryLimit: z.literal(20).default(20),
  })
  .strict();

export const queryPlanSchema = z.discriminatedUnion("intent", [supportedQueryPlanSchema, unsupportedQueryPlanSchema]);

export type QueryPlan = z.infer<typeof queryPlanSchema>;
export type SupportedQueryPlan = z.infer<typeof supportedQueryPlanSchema>;

export const evidenceSchema = z
  .object({
    id: z.string().regex(/^E\d+$/, "证据 ID 必须为 E 加数字"),
    kind: z.enum(["database", "document", "derived"]),
    source: z.string().min(1).max(120),
    location: z.string().min(1).max(240),
    queryParameters: z.record(z.string(), z.unknown()).optional(),
    content: z.unknown(),
    derivedFrom: z.array(z.string().regex(/^E\d+$/)).max(16).optional(),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;

export const verifiedClaimSchema = z
  .object({
    id: z.string().regex(/^C\d+$/, "核验结论 ID 必须为 C 加数字"),
    status: z.enum(["confirmed", "non_compliant", "prohibited", "insufficient_evidence"]),
    statement: z.string().min(1).max(600),
    evidenceIds: z.array(z.string().regex(/^E\d+$/)).min(1).max(8),
  })
  .strict();

export type VerifiedClaim = z.infer<typeof verifiedClaimSchema>;

export const executionStepLabelSchema = z.enum([
  "已解析问题与数据源",
  "已查询运行告警记录",
  "已查询维检工单记录",
  "已检索故障处理手册",
  "已检索安全管理规程",
  "已完成重复故障分析",
  "已完成合规规则核验",
  "文档语义检索已降级为关键词检索",
]);

export const executionStepSchema = z
  .object({
    label: executionStepLabelSchema,
    status: z.enum(["done", "degraded"]),
  })
  .strict();

export const executionProgressPartDataSchema = z
  .object({
    phase: z.enum(["planning", "retrieving", "answering"]),
    completedSteps: z.array(executionStepSchema).max(8),
  })
  .strict();

export type ExecutionProgressPartData = z.infer<typeof executionProgressPartDataSchema>;

export const scopePartDataSchema = z.object({ kind: z.literal("out_of_scope") }).strict();

export type ScopePartData = z.infer<typeof scopePartDataSchema>;

export const evidencePartDataSchema = z
  .object({
    evidence: z.array(evidenceSchema).max(16),
    claims: z.array(verifiedClaimSchema).max(16).default([]),
    executionSteps: z.array(executionStepSchema).max(8),
    invalidEvidenceIds: z.array(z.string().regex(/^E\d+$/)).max(8).default([]),
  })
  .strict();

export type EvidencePartData = z.infer<typeof evidencePartDataSchema>;
