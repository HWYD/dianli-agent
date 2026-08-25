import type { LanguageModel } from "ai";

import { createArkEmbeddings, createArkProvider, getArkRuntimeConfig } from "../ai/ark";
import { closeDatabase, createWindFarmRepository, openReadOnlyDatabase } from "../data/repository";
import { getCachedMemorySemanticSearch, loadRagIndex, validateRagIndex } from "../rag/index";
import { createHybridRetriever } from "../rag/retriever";
import { createAnswerPrompt } from "./answer-prompt";
import { createQueryPlan } from "./planner";
import { collectControlledEvidence } from "./runner";
import { type EvidencePartData, type ExecutionProgressPartData, userQuestionSchema } from "./schemas";

type ProgressReporter = (progress: ExecutionProgressPartData) => void;

export const outOfScopeAnswer = `## 问题范围提示

当前演示仅基于随题提供的风机告警、维检工单、故障处理手册和安全管理规程回答问题，暂不回答通识定义或与题目资料无关的问题。

你可以查询风机状态和告警、维检工单、故障处理要求或安全管理规程。`;

export type PreparedAgentResponse =
  | {
      kind: "scope";
      answer: string;
    }
  | {
      kind: "grounded";
      model: LanguageModel;
      evidence: EvidencePartData["evidence"];
      claims: EvidencePartData["claims"];
      executionSteps: EvidencePartData["executionSteps"];
      prompt: string;
    };

export async function prepareAgentResponse(
  question: string,
  abortSignal?: AbortSignal,
  onProgress?: ProgressReporter,
): Promise<PreparedAgentResponse> {
  const parsedQuestion = userQuestionSchema.parse(question);
  const config = getArkRuntimeConfig();
  const provider = createArkProvider(config);
  const model = provider.chatModel(config.chatModel);
  const completedSteps: EvidencePartData["executionSteps"] = [];
  const reportProgress = (phase: ExecutionProgressPartData["phase"]) => {
    onProgress?.({ phase, completedSteps: [...completedSteps] });
  };

  reportProgress("planning");
  const plan = await createQueryPlan(parsedQuestion, model, abortSignal);
  if (plan.intent === "unsupported") {
    return { kind: "scope", answer: outOfScopeAnswer };
  }

  reportProgress("retrieving");
  const needsDocuments = plan.sources.includes("fault_manual") || plan.sources.includes("safety_policy");
  let retriever = createHybridRetriever([]);

  if (needsDocuments) {
    const index = loadRagIndex();
    const indexErrors = validateRagIndex(index, config.embeddingModel);
    if (indexErrors.length > 0) {
      throw new Error(indexErrors.join("；"));
    }
    retriever = createHybridRetriever(index.chunks, {
      semanticSearch: await getCachedMemorySemanticSearch(index, createArkEmbeddings(config)),
    });
  }

  const database = openReadOnlyDatabase();
  try {
    const execution = await collectControlledEvidence({
      question: parsedQuestion,
      plan,
      repository: createWindFarmRepository(database),
      retriever,
      onStep: (step) => {
        completedSteps.push(step);
        reportProgress("retrieving");
      },
    });
    reportProgress("answering");
    return {
      kind: "grounded",
      model,
      evidence: execution.evidence,
      claims: execution.claims,
      executionSteps: execution.executionSteps,
      prompt: createAnswerPrompt(parsedQuestion, execution.evidence, execution.claims),
    };
  } finally {
    closeDatabase(database);
  }
}
