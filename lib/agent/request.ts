import { z } from "zod";

import { userQuestionSchema } from "./schemas";

const incomingMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

export function extractLatestUserQuestion(messages: unknown): string {
  const parsedMessages = z.array(incomingMessageSchema).min(1).parse(messages);
  const latest = parsedMessages.at(-1)!;
  if (latest.role !== "user") {
    throw new Error("最后一条消息必须来自用户");
  }

  const question = latest.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("\n");
  if (question.length > 1000) {
    throw new Error("问题长度不能超过 1000 个字符");
  }
  return userQuestionSchema.parse(question);
}
