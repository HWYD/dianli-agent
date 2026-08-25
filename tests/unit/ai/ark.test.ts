import { describe, expect, it } from "vitest";

import {
  ARK_BASE_URL,
  ARK_CHAT_MODEL,
  ARK_EMBEDDING_MODEL,
  createArkProvider,
  embedDocumentsInBatches,
  getArkRuntimeConfig,
} from "@/lib/ai/ark";

describe("火山方舟固定模型配置", () => {
  it("使用同一 Base URL 和固定的聊天、向量模型", () => {
    const config = getArkRuntimeConfig({ ARK_API_KEY: "test-key" });
    const provider = createArkProvider(config);

    expect(config).toMatchObject({
      baseUrl: ARK_BASE_URL,
      chatModel: ARK_CHAT_MODEL,
      embeddingModel: ARK_EMBEDDING_MODEL,
    });
    expect(provider.chatModel(config.chatModel).modelId).toBe(ARK_CHAT_MODEL);
    expect(provider.embeddingModel(config.embeddingModel).modelId).toBe(ARK_EMBEDDING_MODEL);
  });

  it("在缺少服务端 API Key 时拒绝启动", () => {
    expect(() => getArkRuntimeConfig({})).toThrow("缺少 ARK_API_KEY");
  });

  it("拒绝与已确认方案不一致的 Base URL 或模型覆盖", () => {
    expect(() => getArkRuntimeConfig({ ARK_API_KEY: "test-key", ARK_BASE_URL: "https://example.com/v1" })).toThrow(
      "ARK_BASE_URL 必须使用已确认的方舟地址",
    );
    expect(() => getArkRuntimeConfig({ ARK_API_KEY: "test-key", ARK_CHAT_MODEL: "other-model" })).toThrow(
      "ARK_CHAT_MODEL 已固定为 deepseek-v4-pro",
    );
  });
});

describe("Embedding 请求分批", () => {
  it("每批最多十条，并按输入顺序合并向量", async () => {
    const requests: string[][] = [];
    const values = Array.from({ length: 23 }, (_, index) => `chunk-${index + 1}`);

    const vectors = await embedDocumentsInBatches(values, 10, async (batch) => {
      requests.push(batch);
      return batch.map((value) => [Number(value.replace("chunk-", ""))]);
    });

    expect(requests).toEqual([
      ["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5", "chunk-6", "chunk-7", "chunk-8", "chunk-9", "chunk-10"],
      ["chunk-11", "chunk-12", "chunk-13", "chunk-14", "chunk-15", "chunk-16", "chunk-17", "chunk-18", "chunk-19", "chunk-20"],
      ["chunk-21", "chunk-22", "chunk-23"],
    ]);
    expect(vectors).toEqual(values.map((_, index) => [index + 1]));
  });
});
