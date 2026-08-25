const genericChatError = "回答生成失败，请检查本地环境后重新提交问题。";

export function getSafeChatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|deadline/i.test(message)) {
    return "本次请求超时，请检查本地网络后重新提交问题。";
  }
  if (message.includes("QueryPlan")) {
    return "查询规划未通过安全校验，请换一种更明确的表述后重试。";
  }
  if (message.includes("rag-index.json") || message.includes("RAG 索引") || message.includes("源文档已变化")) {
    return "文档索引尚未初始化或已过期，请运行 pnpm ingest:docs 后重试。";
  }
  return genericChatError;
}
