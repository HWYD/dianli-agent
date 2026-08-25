import { createArkEmbeddings, getArkRuntimeConfig } from "../lib/ai/ark";
import { buildRagIndex, writeRagIndex } from "../lib/rag/index";

async function main() {
  const config = getArkRuntimeConfig();
  const index = await buildRagIndex({
    embeddingModel: config.embeddingModel,
    baseUrl: config.baseUrl,
    embeddings: createArkEmbeddings(config),
  });
  writeRagIndex(index);
  console.log(`已生成 RAG 索引：${index.chunks.length} 个业务片段，向量维度 ${index.dimension}。`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "文档索引生成失败");
  process.exitCode = 1;
});
