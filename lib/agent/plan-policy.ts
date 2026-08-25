import { supportedQueryPlanSchema, type QueryPlan, type SupportedQueryPlan } from "./schemas";

const sourceOrder = ["alarms", "work_orders", "fault_manual", "safety_policy"] as const;
type Source = (typeof sourceOrder)[number];

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractTurbineIds(question: string): string[] {
  return unique(Array.from(question.matchAll(/\b(T0[1-9])\b/gi), (match) => match[1]!.toUpperCase()));
}

function extractFaultCodes(question: string): string[] {
  return unique(Array.from(question.matchAll(/(?<!\d)(24\d{3})(?!\d)/g), (match) => match[1]!));
}

function extractTimeRange(question: string): SupportedQueryPlan["timeRange"] {
  const timestamps = Array.from(
    question.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g),
    (match) => match[0]!,
  );
  if (timestamps.length < 2) {
    return undefined;
  }
  const [from, to] = timestamps.slice(0, 2).sort();
  return { from, to };
}

function isPurePolicyLookup(question: string, turbineIds: string[], faultCodes: string[]): boolean {
  return (
    turbineIds.length === 0 &&
    faultCodes.length === 0 &&
    /远程.*复位|强制复位/.test(question) &&
    !/工单|安排|优先级|当前|状态|告警|报警/.test(question)
  );
}

function requiredSources(
  plan: SupportedQueryPlan,
  question: string,
  isPurePolicyQuestion: boolean,
): SupportedQueryPlan["sources"] {
  if (isPurePolicyQuestion) {
    return ["safety_policy"];
  }

  const sources = new Set<Source>(plan.sources);
  switch (plan.intent) {
    case "turbine_status":
    case "alarm_query":
      sources.add("alarms");
      break;
    case "work_order_query":
      sources.add("work_orders");
      break;
    case "fault_guidance":
      sources.add("fault_manual");
      break;
    case "policy_lookup":
      break;
    case "compliance_review":
      sources.add("work_orders");
      sources.add("safety_policy");
      break;
    default:
      break;
  }

  if (/告警|报警|状态|运行|发生|当前|最近|最新|严重程度|解除/.test(question)) {
    sources.add("alarms");
  }
  if (/工单|检修|安排|优先级|备件|观察/.test(question)) {
    sources.add("work_orders");
  }
  if (/手册|原因|检查|排查|更换|处理措施/.test(question)) {
    sources.add("fault_manual");
  }
  if (/规程|合规|安全|远程|复位|关闭要求|作业条件/.test(question)) {
    sources.add("safety_policy");
  }

  if (plan.needsRepeatAnalysis) {
    sources.add("alarms");
    sources.add("fault_manual");
    sources.add("safety_policy");
  }
  if (plan.needsComplianceReview) {
    sources.add("work_orders");
    sources.add("safety_policy");
  }

  if (/更换.*条件|具备.*条件|立即更换/.test(question)) {
    sources.add("alarms");
    sources.add("work_orders");
    sources.add("fault_manual");
    sources.add("safety_policy");
  }

  if (sources.size === 0) {
    return plan.sources;
  }
  return sourceOrder.filter((source) => sources.has(source));
}

export function normalizeQueryPlan(plan: SupportedQueryPlan, question: string): SupportedQueryPlan;
export function normalizeQueryPlan(plan: QueryPlan, question: string): QueryPlan;
export function normalizeQueryPlan(plan: QueryPlan, question: string): QueryPlan {
  if (plan.intent === "unsupported") {
    return plan;
  }

  const turbineIds = extractTurbineIds(question);
  const faultCodes = extractFaultCodes(question);
  const timeRange = extractTimeRange(question);
  const normalizedTurbineIds = turbineIds.length > 0 ? turbineIds : plan.turbineIds;
  const normalizedFaultCodes = faultCodes.length > 0 ? faultCodes : plan.faultCodes;
  const purePolicyLookup = isPurePolicyLookup(question, normalizedTurbineIds, normalizedFaultCodes);
  const needsRepeatAnalysis = plan.needsRepeatAnalysis || /重复|频繁|多次|连续发生/.test(question);
  const needsComplianceReview =
    !purePolicyLookup &&
    (plan.needsComplianceReview || /关闭要求|是否符合|合规|优先级|远程.*复位|强制复位|作业前置条件/.test(question));
  const normalizedPlan = {
    ...plan,
    turbineIds: normalizedTurbineIds,
    faultCodes: normalizedFaultCodes,
    timeRange: timeRange ?? plan.timeRange,
    needsRepeatAnalysis,
    needsComplianceReview,
  };

  return supportedQueryPlanSchema.parse({
    ...normalizedPlan,
    sources: requiredSources(normalizedPlan, question, purePolicyLookup),
  });
}
