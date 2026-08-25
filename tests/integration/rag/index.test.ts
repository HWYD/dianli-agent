import { describe, expect, it } from "vitest";

import {
  buildRagIndex,
  clearMemorySemanticSearchCache,
  createMemorySemanticSearch,
  getCachedMemorySemanticSearch,
  validateRagIndex,
} from "@/lib/rag/index";

const deterministicEmbeddings = {
  embedDocuments: async (texts: string[]) => texts.map((_, index) => [index + 1, 1]),
  embedQuery: async () => [1, 1],
};

describe("本地 RAG 索引", () => {
  it("仅为两份业务文档建立可校验的向量索引", async () => {
    const index = await buildRagIndex({
      embeddingModel: "doubao-embedding-vision",
      embeddings: deterministicEmbeddings,
    });

    expect(index.chunks).toHaveLength(34);
    expect(index.dimension).toBe(2);
    expect(Object.keys(index.sourceHashes)).toEqual(
      expect.arrayContaining(["故障处理手册.md", "海上风电机组检修作业与安全管理规程.md"]),
    );
    expect(validateRagIndex(index, "doubao-embedding-vision")).toEqual([]);
  });

  it("在模型或业务文档校验和不一致时拒绝旧索引", async () => {
    const index = await buildRagIndex({
      embeddingModel: "doubao-embedding-vision",
      embeddings: deterministicEmbeddings,
    });

    expect(validateRagIndex(index, "other-model")).toContain("Embedding 模型与索引不一致");
    expect(
      validateRagIndex(
        { ...index, sourceHashes: { ...index.sourceHashes, "故障处理手册.md": "changed" } },
        "doubao-embedding-vision",
      ),
    ).toContain("源文档已变化，请重新运行 pnpm ingest:docs");
  });

  it("用 LangChain MemoryVectorStore 基于预生成向量搜索", async () => {
    const index = await buildRagIndex({
      embeddingModel: "doubao-embedding-vision",
      embeddings: deterministicEmbeddings,
    });
    const search = await createMemorySemanticSearch(index, deterministicEmbeddings);
    const results = await search("任意问题", 3);

    expect(results).toHaveLength(3);
    expect(results[0]?.chunkId).toMatch(/^(fault_manual|safety_policy):/);
  });

  it("对同一已校验索引复用内存向量库，并在模型变化时重建", async () => {
    const index = await buildRagIndex({
      embeddingModel: "doubao-embedding-vision",
      embeddings: deterministicEmbeddings,
    });
    clearMemorySemanticSearchCache();

    const first = await getCachedMemorySemanticSearch(index, deterministicEmbeddings);
    const second = await getCachedMemorySemanticSearch(index, deterministicEmbeddings);
    const changedModel = await getCachedMemorySemanticSearch({ ...index, embeddingModel: "other-model" }, deterministicEmbeddings);

    expect(second).toBe(first);
    expect(changedModel).not.toBe(first);
  });
});
