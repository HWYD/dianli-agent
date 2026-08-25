import { createUIMessageStream, createUIMessageStreamResponse, streamText } from "ai";

import { agentRequestDeadlineMs, getRemainingDeadlineMs } from "../../../lib/agent/deadline";
import { extractLatestUserQuestion } from "../../../lib/agent/request";
import { getSafeChatErrorMessage } from "../../../lib/agent/request-errors";
import { prepareAgentResponse } from "../../../lib/agent/service";
import type { WindPowerUIMessage } from "../../../lib/ui/message-types";

export const runtime = "nodejs";
const finalAnswerTimeoutMs = 90_000;
const maxRequestBytes = 64 * 1024;

function isRequestTooLarge(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  return contentLength !== null && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxRequestBytes;
}

export async function POST(request: Request) {
  if (isRequestTooLarge(request)) {
    return Response.json({ error: "请求体不能超过 64 KiB" }, { status: 413 });
  }

  let question: string;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxRequestBytes) {
      return Response.json({ error: "请求体不能超过 64 KiB" }, { status: 413 });
    }
    const body = JSON.parse(rawBody);
    question = extractLatestUserQuestion(body.messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求格式不正确";
    return Response.json({ error: message }, { status: 400 });
  }

  const stream = createUIMessageStream<WindPowerUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const deadlineAt = Date.now() + agentRequestDeadlineMs;
      const abortSignal = AbortSignal.any([request.signal, AbortSignal.timeout(agentRequestDeadlineMs)]);
      const prepared = await prepareAgentResponse(question, abortSignal, (progress) => {
        writer.write({ type: "data-progress", id: "execution-progress", data: progress });
      });
      if (prepared.kind === "scope") {
        writer.write({ type: "data-scope", data: { kind: "out_of_scope" } });
        writer.write({ type: "text-start", id: "scope-answer" });
        writer.write({ type: "text-delta", id: "scope-answer", delta: prepared.answer });
        writer.write({ type: "text-end", id: "scope-answer" });
        return;
      }

      const remainingTimeoutMs = getRemainingDeadlineMs(deadlineAt);
      if (remainingTimeoutMs === 0) {
        throw new Error("Agent request deadline exceeded");
      }
      writer.write({
        type: "data-evidence",
        data: {
          evidence: prepared.evidence,
          claims: prepared.claims,
          executionSteps: prepared.executionSteps,
          invalidEvidenceIds: [],
        },
      });
      const result = streamText({
        model: prepared.model,
        prompt: prepared.prompt,
        abortSignal,
        maxRetries: 0,
        timeout: Math.min(finalAnswerTimeoutMs, remainingTimeoutMs),
      });
      writer.merge(result.toUIMessageStream({ sendReasoning: false, sendStart: false }));
    },
    onError: getSafeChatErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
}
