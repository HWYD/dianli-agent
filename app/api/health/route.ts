import { getArkRuntimeConfig } from "../../../lib/ai/ark";
import { closeDatabase, openReadOnlyDatabase } from "../../../lib/data/repository";
import { getLocalHealthStatus } from "../../../lib/health/checks";
import { loadRagIndex, validateRagIndex } from "../../../lib/rag/index";

export const runtime = "nodejs";

export async function GET() {
  const health = getLocalHealthStatus({
    getEmbeddingModel: () => getArkRuntimeConfig().embeddingModel,
    getRagIndexErrors: (embeddingModel) => validateRagIndex(loadRagIndex(), embeddingModel),
    verifySqlite: () => {
      const database = openReadOnlyDatabase();
      closeDatabase(database);
    },
  });
  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
}
