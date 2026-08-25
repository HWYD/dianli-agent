export const agentRequestDeadlineMs = 120_000;

export function getRemainingDeadlineMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}
