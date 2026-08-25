const composerMinHeight = 38;
const composerMaxHeight = 100;

export function shouldSubmitComposerOnEnter({
  key,
  shiftKey,
  isComposing,
}: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function getComposerTextareaHeight(scrollHeight: number) {
  return Math.min(Math.max(scrollHeight, composerMinHeight), composerMaxHeight);
}
