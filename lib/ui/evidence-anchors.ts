function normalizeDomIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "message";
}

export function getEvidenceAnchorId(messageId: string, evidenceId: string): string {
  return `evidence-${normalizeDomIdSegment(messageId)}-${evidenceId}`;
}
