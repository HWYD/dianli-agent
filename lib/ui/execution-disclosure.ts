import type { ExecutionProgressPartData } from "../agent/schemas";

export function getExecutionDisclosureLabel({
  hasText,
  progressData,
}: {
  hasText: boolean;
  progressData?: ExecutionProgressPartData;
}) {
  if (hasText) {
    return "已完成思考";
  }

  if (!progressData) {
    return "思考中";
  }

  return {
    planning: "正在解析问题与数据源",
    retrieving: "正在检索资料",
    answering: "正在生成回答",
  }[progressData.phase];
}
