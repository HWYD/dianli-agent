import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export type DocumentType = "fault_manual" | "safety_policy";

export interface DocumentChunkMetadata {
  chunkId: string;
  sourceFile: string;
  documentType: DocumentType;
  headingPath: string[];
  faultCode?: string;
  clauseId?: string;
  ordinal: number;
  contentHash: string;
}

export interface DocumentChunk {
  content: string;
  metadata: DocumentChunkMetadata;
}

interface DocumentSource {
  documentType: DocumentType;
  sourceFile: string;
}

const documentSources: DocumentSource[] = [
  { documentType: "fault_manual", sourceFile: "故障处理手册.md" },
  { documentType: "safety_policy", sourceFile: "海上风电机组检修作业与安全管理规程.md" },
];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function extractFaultCode(heading: string): string | undefined {
  return heading.match(/^(24\d{3})(?:_|\s|$)/)?.[1];
}

function extractClauseId(heading: string): string | undefined {
  return heading.match(/^第\s*(\d+\.\d+)\s*条/)?.[1];
}

function parseDocument(source: DocumentSource, markdown: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let documentTitle = "";
  let chapterTitle = "";
  let currentHeading = "";
  let currentLines: string[] = [];
  let ordinal = 0;

  const flushChunk = () => {
    if (!currentHeading) {
      return;
    }

    ordinal += 1;
    const content = currentLines.join("\n").trim();
    const faultCode = source.documentType === "fault_manual" ? extractFaultCode(currentHeading) : undefined;
    const clauseId = source.documentType === "safety_policy" ? extractClauseId(currentHeading) : undefined;
    const chunkId = `${source.documentType}:${ordinal}`;

    chunks.push({
      content,
      metadata: {
        chunkId,
        sourceFile: source.sourceFile,
        documentType: source.documentType,
        headingPath: [documentTitle, chapterTitle, currentHeading].filter(Boolean),
        faultCode,
        clauseId,
        ordinal,
        contentHash: sha256(content),
      },
    });
  };

  for (const line of lines) {
    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);

    if (h1) {
      flushChunk();
      currentHeading = "";
      currentLines = [];
      documentTitle = h1[1]!.trim();
      continue;
    }

    if (h2) {
      flushChunk();
      currentHeading = "";
      currentLines = [];
      chapterTitle = h2[1]!.trim();
      continue;
    }

    if (h3) {
      flushChunk();
      currentHeading = h3[1]!.trim();
      currentLines = [line];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flushChunk();
  return chunks;
}

export function loadBusinessDocumentChunks(
  documentsDirectory = path.join(process.cwd(), "docs", "require"),
): DocumentChunk[] {
  return documentSources.flatMap((source) => {
    const filePath = path.join(documentsDirectory, source.sourceFile);
    return parseDocument(source, readFileSync(filePath, "utf8"));
  });
}

export function getBusinessDocumentSourceHashes(
  documentsDirectory = path.join(process.cwd(), "docs", "require"),
): Record<string, string> {
  return Object.fromEntries(
    documentSources.map((source) => {
      const filePath = path.join(documentsDirectory, source.sourceFile);
      return [source.sourceFile, sha256(readFileSync(filePath, "utf8"))];
    }),
  );
}
