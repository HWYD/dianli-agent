import type { DocumentChunk, DocumentType } from "./documents";

const keywordWeight = 0.55;
const semanticWeight = 0.45;
const rrfOffset = 60;
const defaultMaxResults = 4;
const defaultMaxContextCharacters = 8000;

export interface SemanticSearchResult {
  chunkId: string;
  score: number;
}

export interface HybridRetrieverOptions {
  semanticSearch?: (question: string, limit: number) => Promise<SemanticSearchResult[]>;
}

export interface HybridRetrieveOptions {
  maxResults?: number;
  maxContextCharacters?: number;
  documentTypes?: DocumentType[];
  requiredClauseIds?: string[];
}

export interface HybridRetrieveResult {
  chunks: DocumentChunk[];
  context: string;
  degraded: boolean;
  exactMatches: string[];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function extractFaultCodes(question: string): string[] {
  return unique(Array.from(question.matchAll(/(?<!\d)(24\d{3})(?!\d)/g), (match) => match[1]!));
}

function extractClauseIds(question: string): string[] {
  return unique(
    Array.from(question.matchAll(/第?\s*(\d+\.\d+)\s*条?/g), (match) => match[1]!).filter(
      (value) => /^\d+\.\d+$/.test(value),
    ),
  );
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  const alphanumeric = normalized.match(/[a-z0-9.]+/g) ?? [];
  const han = Array.from(normalized.matchAll(/[\u4e00-\u9fff]/g), (match) => match[0]!);
  const bigrams = han.slice(0, -1).map((character, index) => `${character}${han[index + 1]}`);
  return unique([...alphanumeric, ...bigrams]);
}

function occurrences(text: string, token: string): number {
  if (!token) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const found = text.indexOf(token, cursor);
    if (found === -1) {
      break;
    }
    count += 1;
    cursor = found + token.length;
  }
  return count;
}

function keywordScore(chunk: DocumentChunk, queryTokens: string[]): number {
  const title = chunk.metadata.headingPath.join(" ").toLowerCase();
  const content = chunk.content.toLowerCase();
  return queryTokens.reduce(
    (score, token) => score + occurrences(content, token) + occurrences(title, token) * 2.5,
    0,
  );
}

function rankKeyword(chunks: DocumentChunk[], question: string): DocumentChunk[] {
  const queryTokens = tokenize(question);
  return chunks
    .map((chunk) => ({ chunk, score: keywordScore(chunk, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.metadata.chunkId.localeCompare(right.chunk.metadata.chunkId))
    .map(({ chunk }) => chunk);
}

function rankRrf(
  keywordRanks: DocumentChunk[],
  semanticRanks: DocumentChunk[],
  chunksById: Map<string, DocumentChunk>,
): DocumentChunk[] {
  const scoreById = new Map<string, number>();
  const addRanks = (rankedChunks: DocumentChunk[], weight: number) => {
    rankedChunks.forEach((chunk, index) => {
      const previous = scoreById.get(chunk.metadata.chunkId) ?? 0;
      scoreById.set(chunk.metadata.chunkId, previous + weight / (rrfOffset + index + 1));
    });
  };

  addRanks(keywordRanks, keywordWeight);
  addRanks(semanticRanks, semanticWeight);

  return [...scoreById.entries()]
    .sort(
      ([leftId, leftScore], [rightId, rightScore]) =>
        rightScore - leftScore || leftId.localeCompare(rightId),
    )
    .map(([chunkId]) => chunksById.get(chunkId)!)
    .filter(Boolean);
}

function renderContext(chunks: DocumentChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `[${chunk.metadata.chunkId}] ${chunk.metadata.sourceFile} · ${chunk.metadata.headingPath.join(" > ")}\n${chunk.content}`,
    )
    .join("\n\n");
}

export function createHybridRetriever(chunks: DocumentChunk[], options: HybridRetrieverOptions = {}) {
  return {
    async retrieve(question: string, retrieveOptions: HybridRetrieveOptions = {}): Promise<HybridRetrieveResult> {
      const maxResults = retrieveOptions.maxResults ?? defaultMaxResults;
      const maxContextCharacters = retrieveOptions.maxContextCharacters ?? defaultMaxContextCharacters;
      const candidateChunks = retrieveOptions.documentTypes
        ? chunks.filter((chunk) => retrieveOptions.documentTypes!.includes(chunk.metadata.documentType))
        : chunks;
      const chunksById = new Map(candidateChunks.map((chunk) => [chunk.metadata.chunkId, chunk]));
      const faultCodes = extractFaultCodes(question);
      const clauseIds = extractClauseIds(question);
      const requiredClauseIds = retrieveOptions.requiredClauseIds ?? [];
      const requiredChunks = requiredClauseIds
        .map((clauseId) => candidateChunks.find((chunk) => chunk.metadata.clauseId === clauseId))
        .filter((chunk): chunk is DocumentChunk => chunk !== undefined);
      const exactChunks = candidateChunks.filter(
        (chunk) =>
          (chunk.metadata.faultCode !== undefined && faultCodes.includes(chunk.metadata.faultCode)) ||
          (chunk.metadata.clauseId !== undefined && clauseIds.includes(chunk.metadata.clauseId)),
      );
      const keywordRanks = rankKeyword(candidateChunks, question);
      let semanticRanks: DocumentChunk[] = [];
      let degraded = !options.semanticSearch;

      if (options.semanticSearch) {
        try {
          const semanticResults = await options.semanticSearch(question, 8);
          semanticRanks = unique(semanticResults.map((result) => result.chunkId))
            .map((chunkId) => chunksById.get(chunkId))
            .filter((chunk): chunk is DocumentChunk => chunk !== undefined);
        } catch {
          degraded = true;
        }
      }

      const fused = rankRrf(keywordRanks, semanticRanks, chunksById);
      const ordered = unique([...requiredChunks, ...exactChunks, ...fused]);
      const selected: DocumentChunk[] = [];

      for (const chunk of ordered) {
        if (selected.length >= maxResults) {
          break;
        }
        const nextContext = renderContext([...selected, chunk]);
        if (nextContext.length > maxContextCharacters) {
          break;
        }
        selected.push(chunk);
      }

      return {
        chunks: selected,
        context: renderContext(selected),
        degraded,
        exactMatches: unique([...requiredChunks, ...exactChunks]).map((chunk) => chunk.metadata.chunkId),
      };
    },
  };
}
