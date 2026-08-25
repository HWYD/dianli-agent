export const publicAssessmentQuestions = [
  "查询 T06 的风机型号、最新运行状态和告警时间",
  "查询 T04 在 2026-07-10 至 2026-07-15 期间的告警记录",
  "24002_SC_变流器心跳的常见原因、检查项与通讯模块更换安全注意事项",
  "哪些情形禁止远程强制复位或继续反复远程复位？",
  "分析 T03 的 24002 重复故障、工单优先级与远程复位建议",
  "检查 T09 的 24011 已完成工单是否符合关闭要求",
  "分析 T07 的 24012 重复故障、对应工单和故障手册检查项",
] as const;

function hashSeed(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function selectRecommendedQuestions(answerId: string, currentQuestion?: string) {
  return publicAssessmentQuestions
    .filter((question) => question !== currentQuestion)
    .map((question) => ({ question, rank: hashSeed(`${answerId}:${question}`) }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 3)
    .map(({ question }) => question);
}
