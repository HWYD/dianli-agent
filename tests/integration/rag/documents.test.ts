import { describe, expect, it } from "vitest";

import { loadBusinessDocumentChunks } from "@/lib/rag/documents";

describe("业务 Markdown 切块", () => {
  it("只将故障手册切为完整的故障码章节", () => {
    const chunks = loadBusinessDocumentChunks();
    const manualChunks = chunks.filter((chunk) => chunk.metadata.documentType === "fault_manual");
    const heartbeat = manualChunks.find((chunk) => chunk.metadata.faultCode === "24002");

    expect(manualChunks).toHaveLength(9);
    expect(heartbeat).toMatchObject({
      metadata: {
        sourceFile: "故障处理手册.md",
        headingPath: ["故障处理手册", "20 变频器故障", "24002_SC_变流器心跳"],
      },
    });
    expect(heartbeat?.content).toContain("不得以多次远程复位代替重复故障排查");
    expect(heartbeat?.content).toContain("母线电压降至约 20 V");
  });

  it("将安全规程切为独立条款，并保留条款号与章节路径", () => {
    const chunks = loadBusinessDocumentChunks();
    const policyChunks = chunks.filter((chunk) => chunk.metadata.documentType === "safety_policy");
    const remoteResetRule = policyChunks.find((chunk) => chunk.metadata.clauseId === "4.1");

    expect(policyChunks).toHaveLength(25);
    expect(remoteResetRule).toMatchObject({
      metadata: {
        sourceFile: "海上风电机组检修作业与安全管理规程.md",
        headingPath: ["海上风电机组检修作业与安全管理规程", "第四章 禁止远程复位", "第 4.1 条 禁止情形"],
      },
    });
    expect(remoteResetRule?.content).toContain("连续 24 小时内发生 3 次及以上");
  });

  it("不将题目说明或公开问题加入业务索引", () => {
    const chunks = loadBusinessDocumentChunks();

    expect(chunks).toHaveLength(34);
    expect(chunks.some((chunk) => chunk.metadata.sourceFile === "考察问题.md")).toBe(false);
    expect(chunks.every((chunk) => chunk.metadata.contentHash.length === 64)).toBe(true);
  });
});
