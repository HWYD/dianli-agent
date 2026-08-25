import { describe, expect, it } from "vitest";

import { loadBusinessDocumentChunks } from "@/lib/rag/documents";
import { createHybridRetriever } from "@/lib/rag/retriever";

const chunks = loadBusinessDocumentChunks();

describe("双路 Hybrid RAG", () => {
  it("将故障码 Exact 路由的完整手册章节固定置顶", async () => {
    const retriever = createHybridRetriever(chunks);
    const result = await retriever.retrieve("24002 变流器心跳怎么处理？");

    expect(result.degraded).toBe(true);
    expect(result.chunks[0]?.metadata.faultCode).toBe("24002");
    expect(result.chunks[0]?.content).toContain("故障处理注意事项");
  });

  it("通过关键词召回规程第 4.1 条", async () => {
    const retriever = createHybridRetriever(chunks);
    const result = await retriever.retrieve("哪些情形禁止远程强制复位？");

    expect(result.chunks.some((chunk) => chunk.metadata.clauseId === "4.1")).toBe(true);
  });

  it("将语义结果与关键词排名做 RRF 融合并按 chunkId 去重", async () => {
    const remoteResetRule = chunks.find((chunk) => chunk.metadata.clauseId === "4.1")!;
    const retriever = createHybridRetriever(chunks, {
      semanticSearch: async () => [
        { chunkId: remoteResetRule.metadata.chunkId, score: 0.98 },
        { chunkId: remoteResetRule.metadata.chunkId, score: 0.97 },
      ],
    });
    const result = await retriever.retrieve("什么时候不能继续远程重启？");

    expect(result.degraded).toBe(false);
    expect(result.chunks.filter((chunk) => chunk.metadata.chunkId === remoteResetRule.metadata.chunkId)).toHaveLength(1);
    expect(result.chunks[0]?.metadata.clauseId).toBe("4.1");
  });

  it("将普通问题限制为四个片段和八千字符上下文", async () => {
    const retriever = createHybridRetriever(chunks);
    const result = await retriever.retrieve("变流器故障处理与安全注意事项");

    expect(result.chunks.length).toBeLessThanOrEqual(4);
    expect(result.context.length).toBeLessThanOrEqual(8000);
  });

  it("在检索前按请求的文档类型筛选候选，避免跨文档结果被事后丢弃", async () => {
    const retriever = createHybridRetriever(chunks);
    const result = await retriever.retrieve("哪些情形禁止远程强制复位？", {
      maxResults: 4,
      documentTypes: ["fault_manual"],
    });

    expect(result.chunks.every((chunk) => chunk.metadata.documentType === "fault_manual")).toBe(true);
  });

  it("将调用方声明的关键规程条款置于 Top-K 之前", async () => {
    const retriever = createHybridRetriever(chunks);
    const result = await retriever.retrieve("远程操作边界", {
      maxResults: 2,
      documentTypes: ["safety_policy"],
      requiredClauseIds: ["4.1", "4.2"],
    });

    expect(result.chunks.map((chunk) => chunk.metadata.clauseId)).toEqual(["4.1", "4.2"]);
  });

  it("在首个片段已超出预算时也不突破上下文字符上限", async () => {
    const retriever = createHybridRetriever(chunks);
    const result = await retriever.retrieve("24002 变流器心跳", {
      maxResults: 4,
      maxContextCharacters: 10,
    });

    expect(result.chunks).toHaveLength(0);
    expect(result.context).toHaveLength(0);
  });
});
