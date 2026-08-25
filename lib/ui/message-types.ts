import type { UIMessage } from "ai";

import type { EvidencePartData, ExecutionProgressPartData, ScopePartData } from "../agent/schemas";

export type WindPowerUIMessage = UIMessage<
  never,
  { evidence: EvidencePartData; progress: ExecutionProgressPartData; scope: ScopePartData }
>;
