import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  getBusinessDocumentSourceHashes,
  loadBusinessDocumentChunks,
  type DocumentChunk,
} from "./documents";
import type { SemanticSearchResult } from "./retriever";

export interface StoredDocumentChunk extends DocumentChunk {
  vector: number[];
}

export interface RagIndex {
  version: 1;
  createdAt: string;
  baseUrl: string;
  embeddingModel: string;
  dimension: number;
  sourceHashes: Record<string, string>;
  chunks: StoredDocumentChunk[];
}

export interface RagIndexBuildOptions {
  embeddingModel: string;
  baseUrl?: string;
  embeddings: Pick<EmbeddingsInterface, "embedDocuments" | "embedQuery">;
  documentsDirectory?: string;
}

type SemanticSearch = (question: string, limit: number) => Promise<SemanticSearchResult[]>;

let cachedMemorySemanticSearch: { key: string; search: Promise<SemanticSearch> } | null = null;

function getSemanticSearchCacheKey(index: RagIndex): string {
  const sourceHashes = Object.entries(index.sourceHashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceFile, hash]) => `${sourceFile}:${hash}`)
    .join("|");
  const chunks = index.chunks
    .map((chunk) => `${chunk.metadata.chunkId}:${chunk.metadata.contentHash}`)
    .join("|");
  return `${index.embeddingModel}|${index.baseUrl}|${index.dimension}|${sourceHashes}|${chunks}`;
}

function assertVectors(vectors: number[][], expectedCount: number): number {
  if (vectors.length !== expectedCount || vectors.length === 0) {
    throw new Error("Embedding 返回数量与文档 chunk 数量不一致");
  }

  const dimension = vectors[0]?.length ?? 0;
  if (dimension === 0 || vectors.some((vector) => vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("Embedding 向量维度不一致或包含无效数值");
  }
  return dimension;
}

export async function buildRagIndex(options: RagIndexBuildOptions): Promise<RagIndex> {
  const chunks = loadBusinessDocumentChunks(options.documentsDirectory);
  const vectors = await options.embeddings.embedDocuments(chunks.map((chunk) => chunk.content));
  const dimension = assertVectors(vectors, chunks.length);

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    baseUrl: options.baseUrl ?? process.env.ARK_BASE_URL ?? "",
    embeddingModel: options.embeddingModel,
    dimension,
    sourceHashes: getBusinessDocumentSourceHashes(options.documentsDirectory),
    chunks: chunks.map((chunk, index) => ({ ...chunk, vector: vectors[index]! })),
  };
}

export function writeRagIndex(index: RagIndex, indexPath = path.join(process.cwd(), "data", "rag-index.json")): void {
  mkdirSync(path.dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
}

export function loadRagIndex(indexPath = path.join(process.cwd(), "data", "rag-index.json")): RagIndex {
  return JSON.parse(readFileSync(indexPath, "utf8")) as RagIndex;
}

export function validateRagIndex(
  index: RagIndex,
  expectedEmbeddingModel: string,
  documentsDirectory?: string,
): string[] {
  const errors: string[] = [];
  if (index.version !== 1) {
    errors.push("不支持的 RAG 索引版本");
  }
  if (index.embeddingModel !== expectedEmbeddingModel) {
    errors.push("Embedding 模型与索引不一致");
  }
  if (index.chunks.length === 0 || index.dimension <= 0) {
    errors.push("RAG 索引没有有效的文档向量");
  }
  if (index.chunks.some((chunk) => chunk.vector.length !== index.dimension)) {
    errors.push("RAG 索引向量维度不一致");
  }

  const currentHashes = getBusinessDocumentSourceHashes(documentsDirectory);
  for (const [sourceFile, currentHash] of Object.entries(currentHashes)) {
    if (index.sourceHashes[sourceFile] !== currentHash) {
      errors.push("源文档已变化，请重新运行 pnpm ingest:docs");
      break;
    }
  }
  return errors;
}

export async function createMemorySemanticSearch(
  index: RagIndex,
  embeddings: Pick<EmbeddingsInterface, "embedDocuments" | "embedQuery">,
): Promise<(question: string, limit: number) => Promise<SemanticSearchResult[]>> {
  const vectorStore = new MemoryVectorStore(embeddings);
  const documents = index.chunks.map(
    (chunk) =>
      new Document({
        pageContent: chunk.content,
        metadata: chunk.metadata,
      }),
  );
  await vectorStore.addVectors(
    index.chunks.map((chunk) => chunk.vector),
    documents,
  );

  return async (question: string, limit: number) => {
    const queryVector = await embeddings.embedQuery(question);
    const results = await vectorStore.similaritySearchVectorWithScore(queryVector, limit);
    return results.map(([document, score]) => ({
      chunkId: String(document.metadata.chunkId),
      score,
    }));
  };
}

export async function getCachedMemorySemanticSearch(
  index: RagIndex,
  embeddings: Pick<EmbeddingsInterface, "embedDocuments" | "embedQuery">,
): Promise<SemanticSearch> {
  const key = getSemanticSearchCacheKey(index);
  if (!cachedMemorySemanticSearch || cachedMemorySemanticSearch.key !== key) {
    cachedMemorySemanticSearch = {
      key,
      search: createMemorySemanticSearch(index, embeddings),
    };
  }
  return cachedMemorySemanticSearch.search;
}

export function clearMemorySemanticSearchCache(): void {
  cachedMemorySemanticSearch = null;
}
