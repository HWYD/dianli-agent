import { embed, embedMany } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3";
export const ARK_CHAT_MODEL = "deepseek-v4-pro";
export const ARK_EMBEDDING_MODEL = "doubao-embedding-vision";
const maxEmbeddingInputsPerRequest = 10;

export interface ArkRuntimeConfig {
  apiKey: string;
  baseUrl: typeof ARK_BASE_URL;
  chatModel: typeof ARK_CHAT_MODEL;
  embeddingModel: typeof ARK_EMBEDDING_MODEL;
}

export function getArkRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): ArkRuntimeConfig {
  const apiKey = environment.ARK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少 ARK_API_KEY，请在 .env.local 中配置");
  }
  if (environment.ARK_BASE_URL && environment.ARK_BASE_URL !== ARK_BASE_URL) {
    throw new Error("ARK_BASE_URL 必须使用已确认的方舟地址");
  }
  if (environment.ARK_CHAT_MODEL && environment.ARK_CHAT_MODEL !== ARK_CHAT_MODEL) {
    throw new Error("ARK_CHAT_MODEL 已固定为 deepseek-v4-pro");
  }
  if (environment.ARK_EMBEDDING_MODEL && environment.ARK_EMBEDDING_MODEL !== ARK_EMBEDDING_MODEL) {
    throw new Error("ARK_EMBEDDING_MODEL 已固定为 doubao-embedding-vision");
  }

  return {
    apiKey,
    baseUrl: ARK_BASE_URL,
    chatModel: ARK_CHAT_MODEL,
    embeddingModel: ARK_EMBEDDING_MODEL,
  };
}

export function createArkProvider(config: ArkRuntimeConfig) {
  return createOpenAICompatible({
    name: "volcengineArk",
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    includeUsage: true,
    supportsStructuredOutputs: false,
  });
}

export async function embedDocumentsInBatches(
  documents: string[],
  batchSize: number,
  embedBatch: (batch: string[]) => Promise<number[][]>,
): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let start = 0; start < documents.length; start += batchSize) {
    embeddings.push(...(await embedBatch(documents.slice(start, start + batchSize))));
  }
  return embeddings;
}

export function createArkEmbeddings(config: ArkRuntimeConfig) {
  const embeddingModel = createArkProvider(config).embeddingModel(config.embeddingModel);

  return {
    async embedDocuments(documents: string[], abortSignal?: AbortSignal): Promise<number[][]> {
      return embedDocumentsInBatches(documents, maxEmbeddingInputsPerRequest, async (batch) => {
        const result = await embedMany({
          model: embeddingModel,
          values: batch,
          abortSignal,
          maxRetries: 0,
        });
        return result.embeddings;
      });
    },

    async embedQuery(document: string, abortSignal?: AbortSignal): Promise<number[]> {
      const result = await embed({
        model: embeddingModel,
        value: document,
        abortSignal,
        maxRetries: 0,
      });
      return result.embedding;
    },
  };
}
