export type RequestExecutionState = "thinking" | "failed" | null;

export function getRequestExecutionState({
  isRunning,
  lastMessageRole,
  hasVisibleAssistantContent,
  hasError,
}: {
  isRunning: boolean;
  lastMessageRole?: string;
  hasVisibleAssistantContent?: boolean;
  hasError: boolean;
}): RequestExecutionState {
  if (hasError) {
    return "failed";
  }
  const isAssistantContentVisible = hasVisibleAssistantContent ?? lastMessageRole === "assistant";
  return isRunning && !isAssistantContentVisible ? "thinking" : null;
}
