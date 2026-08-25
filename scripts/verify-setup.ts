import { embed, generateText, streamText } from "ai";

import { createArkProvider, getArkRuntimeConfig } from "../lib/ai/ark";
import { parseQueryPlanText } from "../lib/agent/planner";
import { closeDatabase, openReadOnlyDatabase } from "../lib/data/repository";
import { loadRagIndex, validateRagIndex } from "../lib/rag/index";

async function main() {
  const config = getArkRuntimeConfig();
  const provider = createArkProvider(config);
  const queryPlan = await generateText({
    model: provider.chatModel(config.chatModel),
    prompt:
      '只输出 JSON：{"intent":"turbine_status","turbineIds":["T01"],"faultCodes":[],"sources":["alarms"],"workOrderStatuses":[],"needsRepeatAnalysis":false,"needsComplianceReview":false,"queryLimit":20}',
    maxRetries: 0,
    providerOptions: { volcengineArk: { response_format: { type: "json_object" } } },
  });
  parseQueryPlanText(queryPlan.text);

  const stream = streamText({
    model: provider.chatModel(config.chatModel),
    prompt: "仅输出：本地流式调用正常。",
    maxRetries: 0,
  });
  await stream.text;

  const vector = await embed({
    model: provider.embeddingModel(config.embeddingModel),
    value: "海上风电机组维检",
    maxRetries: 0,
  });
  if (vector.embedding.length === 0) {
    throw new Error("Embedding 返回空向量");
  }

  const database = openReadOnlyDatabase();
  closeDatabase(database);

  const indexErrors = validateRagIndex(loadRagIndex(), config.embeddingModel);
  if (indexErrors.length > 0) {
    throw new Error(indexErrors.join("；"));
  }

  console.log(`环境验证通过：聊天模型、流式调用、Embedding（${vector.embedding.length} 维）、SQLite 与 RAG 索引均可用。`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "环境验证失败");
  process.exitCode = 1;
});
