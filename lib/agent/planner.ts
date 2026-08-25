import { generateText, type LanguageModel } from "ai";

import { normalizeQueryPlan } from "./plan-policy";
import { queryPlanSchema, type QueryPlan, type SupportedQueryPlan } from "./schemas";

const queryPlanTimeoutMs = 60_000;
export const plannerSystemPrompt = `你是海上风电维检 Agent 的受控查询规划器。只负责选择本轮需要检索的已有数据源，不回答用户问题，也不生成 SQL。

只输出一个符合以下结构的 JSON 对象；不要 Markdown、解释、代码块或额外字段。
{
  "intent": "turbine_status | alarm_query | work_order_query | fault_guidance | policy_lookup | compliance_review | composite | unsupported",
  "turbineIds": ["T01"],
  "faultCodes": ["24002"],
  "sources": ["alarms"],
  "workOrderStatuses": ["OPEN | PLANNED | IN_PROGRESS | COMPLETED | CANCELLED"],
  "needsRepeatAnalysis": false,
  "needsComplianceReview": false,
  "queryLimit": 20
}

## JSON 契约
- 上述八个字段都必须出现。未知的风机、故障码或工单状态使用空数组；不要使用 turbine_id、fields、answer、tools、reasoning 等其他字段。
- 对通识定义、闲聊或与随题资料无关的问题，intent 必须为 unsupported，且 turbineIds、faultCodes、sources、workOrderStatuses 均为 []，needsRepeatAnalysis 与 needsComplianceReview 均为 false，queryLimit 为 20；不要填写 timeRange。
- sources 是由以下标识符组成的数组：alarms、work_orders、fault_manual、safety_policy。每项必须是一个独立字符串，例如 ["alarms", "work_orders"]，绝不能写成带竖线的单个字符串。unsupported 的 sources 必须为 []。
- turbineIds 仅可填写问题中明确出现的 T01～T09；faultCodes 仅可填写明确出现的 24xxx；无法可靠提取时返回空数组。
- workOrderStatuses 仅在用户明确限定状态时填写 OPEN、PLANNED、IN_PROGRESS、COMPLETED、CANCELLED，否则返回空数组。queryLimit 固定填写 20。
- 只在用户明确询问重复、频繁、多次或连续发生时，将 needsRepeatAnalysis 设为 true；只在用户要求判断合规性、关闭条件、复位许可或作业前置条件时，将 needsComplianceReview 设为 true。

## 意图与来源选择
- 最新状态、型号、告警时间或时间范围内的告警：intent 为 turbine_status 或 alarm_query，包含 alarms。
- 工单安排、优先级、状态、备件或观察记录：intent 为 work_order_query，包含 work_orders。
- 故障原因、排查、处理步骤或更换条件：intent 为 fault_guidance，包含 fault_manual；涉及安全前置条件时再包含 safety_policy。
- 不涉及具体风机、告警或工单的规程条款问题：intent 为 policy_lookup，只包含对应文档来源。
- 工单关闭、远程复位、是否可作业等合规性问题：intent 为 compliance_review，包含 work_orders 和 safety_policy；问题涉及当前告警、重复故障或根因排查时，按需补充 alarms 或 fault_manual。
- 同时覆盖两类及以上问题时使用 composite，并列出所需全部来源。
- 属于上述资料范围但未检索到匹配记录的问题，不是 unsupported，仍选择对应来源检索并由回答阶段说明资料不足。
- 你的输出只是检索计划。服务端会再次标准化实体、时间范围和数据源；不要据此输出结论。`;

const queryPlanRepairSystemPrompt = `${plannerSystemPrompt}

上一轮输出未通过 JSON 契约校验。仅修复为完整、合法的 QueryPlan JSON；不要解释失败原因，也不要输出 Markdown。`;

function extractSingleTurbineId(question: string): string | null {
  const turbineIds = [...new Set(Array.from(question.matchAll(/\b(T0[1-9])\b/gi), (match) => match[1]!.toUpperCase()))];
  return turbineIds.length === 1 ? turbineIds[0]! : null;
}

function buildRuleBasedPlan(
  intent: Extract<SupportedQueryPlan["intent"], "turbine_status" | "alarm_query" | "work_order_query">,
  turbineId: string,
  question: string,
): SupportedQueryPlan {
  const sourceByIntent = {
    turbine_status: "alarms",
    alarm_query: "alarms",
    work_order_query: "work_orders",
  } as const;

  return normalizeQueryPlan(
    {
      intent,
      turbineIds: [turbineId],
      faultCodes: [],
      sources: [sourceByIntent[intent]],
      workOrderStatuses: [],
      needsRepeatAnalysis: false,
      needsComplianceReview: false,
      queryLimit: 20,
    },
    question,
  );
}

export function createRuleBasedQueryPlan(question: string): SupportedQueryPlan | null {
  const turbineId = extractSingleTurbineId(question);
  if (!turbineId && /远程.*复位|强制复位/.test(question)) {
    return normalizeQueryPlan(
      {
        intent: "policy_lookup",
        turbineIds: [],
        faultCodes: [],
        sources: ["safety_policy"],
        workOrderStatuses: [],
        needsRepeatAnalysis: false,
        needsComplianceReview: false,
        queryLimit: 20,
      },
      question,
    );
  }
  if (!turbineId) {
    return null;
  }

  if (/手册|规程|条款|合规|安全|处理办法|处理步骤|排查|复位|重复|连续|频繁|多次/.test(question)) {
    return null;
  }
  if (/工单|检修安排|维检安排|作业安排|派工/.test(question)) {
    return buildRuleBasedPlan("work_order_query", turbineId, question);
  }
  if (/状态|型号|最新运行/.test(question)) {
    return buildRuleBasedPlan("turbine_status", turbineId, question);
  }
  if (/告警|报警/.test(question)) {
    return buildRuleBasedPlan("alarm_query", turbineId, question);
  }
  return null;
}

export function parseQueryPlanText(text: string): QueryPlan {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("QueryPlan 必须是 JSON 对象");
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error("QueryPlan 必须是 JSON 对象");
  }

  const result = queryPlanSchema.safeParse(value);
  if (!result.success) {
    throw new Error("QueryPlan 未通过 Zod 校验");
  }
  return result.data;
}

async function generateQueryPlanText(
  question: string,
  model: LanguageModel,
  system: string,
  prompt: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const result = await generateText({
    model,
    system,
    prompt,
    maxRetries: 0,
    timeout: queryPlanTimeoutMs,
    abortSignal,
    providerOptions: {
      volcengineArk: {
        response_format: { type: "json_object" },
      },
    },
  });
  return result.text;
}

export async function createQueryPlan(
  question: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<QueryPlan> {
  const ruleBasedPlan = createRuleBasedQueryPlan(question);
  if (ruleBasedPlan) {
    return ruleBasedPlan;
  }

  const initialText = await generateQueryPlanText(question, model, plannerSystemPrompt, `用户问题：${question}`, abortSignal);
  try {
    return normalizeQueryPlan(parseQueryPlanText(initialText), question);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "QueryPlan 校验失败";
    const repairedText = await generateQueryPlanText(
      question,
      model,
      queryPlanRepairSystemPrompt,
      `用户问题：${question}\n上一轮无效输出：${initialText}\n校验错误：${reason}`,
      abortSignal,
    );
    return normalizeQueryPlan(parseQueryPlanText(repairedText), question);
  }
}
