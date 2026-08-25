import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatModel: vi.fn(),
  closeDatabase: vi.fn(),
  collectControlledEvidence: vi.fn(),
  createAnswerPrompt: vi.fn(),
  createArkEmbeddings: vi.fn(),
  createArkProvider: vi.fn(),
  createHybridRetriever: vi.fn(),
  createQueryPlan: vi.fn(),
  createWindFarmRepository: vi.fn(),
  getArkRuntimeConfig: vi.fn(),
  getCachedMemorySemanticSearch: vi.fn(),
  loadRagIndex: vi.fn(),
  openReadOnlyDatabase: vi.fn(),
  validateRagIndex: vi.fn(),
}));

vi.mock("@/lib/ai/ark", () => ({
  createArkEmbeddings: mocks.createArkEmbeddings,
  createArkProvider: mocks.createArkProvider,
  getArkRuntimeConfig: mocks.getArkRuntimeConfig,
}));
vi.mock("@/lib/agent/planner", () => ({ createQueryPlan: mocks.createQueryPlan }));
vi.mock("@/lib/agent/answer-prompt", () => ({ createAnswerPrompt: mocks.createAnswerPrompt }));
vi.mock("@/lib/agent/runner", () => ({ collectControlledEvidence: mocks.collectControlledEvidence }));
vi.mock("@/lib/data/repository", () => ({
  closeDatabase: mocks.closeDatabase,
  createWindFarmRepository: mocks.createWindFarmRepository,
  openReadOnlyDatabase: mocks.openReadOnlyDatabase,
}));
vi.mock("@/lib/rag/index", () => ({
  getCachedMemorySemanticSearch: mocks.getCachedMemorySemanticSearch,
  loadRagIndex: mocks.loadRagIndex,
  validateRagIndex: mocks.validateRagIndex,
}));
vi.mock("@/lib/rag/retriever", () => ({ createHybridRetriever: mocks.createHybridRetriever }));

import { prepareAgentResponse } from "@/lib/agent/service";

describe("题外问题服务响应", () => {
  it("返回范围提示且不访问数据库或 RAG", async () => {
    mocks.getArkRuntimeConfig.mockReturnValue({ chatModel: "test-model" });
    mocks.createArkProvider.mockReturnValue({ chatModel: mocks.chatModel });
    mocks.createQueryPlan.mockResolvedValue({
      intent: "unsupported",
      turbineIds: [],
      faultCodes: [],
      sources: [],
      workOrderStatuses: [],
      needsRepeatAnalysis: false,
      needsComplianceReview: false,
      queryLimit: 20,
    });

    const response = await prepareAgentResponse("电力是什么？");

    expect(response).toMatchObject({ kind: "scope", answer: expect.stringContaining("问题范围提示") });
    expect(mocks.openReadOnlyDatabase).not.toHaveBeenCalled();
    expect(mocks.loadRagIndex).not.toHaveBeenCalled();
    expect(mocks.getCachedMemorySemanticSearch).not.toHaveBeenCalled();
    expect(mocks.createArkEmbeddings).not.toHaveBeenCalled();
    expect(mocks.createHybridRetriever).not.toHaveBeenCalled();
    expect(mocks.collectControlledEvidence).not.toHaveBeenCalled();
    expect(mocks.createAnswerPrompt).not.toHaveBeenCalled();
  });
});
