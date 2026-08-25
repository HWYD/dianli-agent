import { describe, expect, it } from "vitest";

import { getLocalHealthStatus } from "@/lib/health/checks";

describe("本地健康检查", () => {
  it("在文档索引异常时仍准确报告方舟配置和 SQLite 正常", () => {
    const result = getLocalHealthStatus({
      getEmbeddingModel: () => "doubao-embedding-vision",
      getRagIndexErrors: () => ["RAG 索引没有有效的文档向量"],
      verifySqlite: () => undefined,
    });

    expect(result).toEqual({
      status: "error",
      checks: { ark: "ok", ragIndex: "error", sqlite: "ok" },
    });
  });

  it("在三个本地依赖均可用时返回健康状态", () => {
    const result = getLocalHealthStatus({
      getEmbeddingModel: () => "doubao-embedding-vision",
      getRagIndexErrors: () => [],
      verifySqlite: () => undefined,
    });

    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({ ark: "ok", ragIndex: "ok", sqlite: "ok" });
  });
});
