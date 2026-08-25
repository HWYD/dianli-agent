export interface LocalHealthStatus {
  status: "ok" | "error";
  checks: Record<"ark" | "ragIndex" | "sqlite", "ok" | "error">;
}

export interface LocalHealthDependencies {
  getEmbeddingModel: () => string;
  getRagIndexErrors: (embeddingModel: string) => string[];
  verifySqlite: () => void;
}

export function getLocalHealthStatus(dependencies: LocalHealthDependencies): LocalHealthStatus {
  const checks: LocalHealthStatus["checks"] = { ark: "error", ragIndex: "error", sqlite: "error" };
  let embeddingModel: string | undefined;

  try {
    embeddingModel = dependencies.getEmbeddingModel();
    checks.ark = "ok";
  } catch {
    checks.ark = "error";
  }

  try {
    if (!embeddingModel || dependencies.getRagIndexErrors(embeddingModel).length > 0) {
      throw new Error("RAG 索引不可用");
    }
    checks.ragIndex = "ok";
  } catch {
    checks.ragIndex = "error";
  }

  try {
    dependencies.verifySqlite();
    checks.sqlite = "ok";
  } catch {
    checks.sqlite = "error";
  }

  return {
    status: Object.values(checks).every((status) => status === "ok") ? "ok" : "error",
    checks,
  };
}
