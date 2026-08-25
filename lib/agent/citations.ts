export function findUnknownEvidenceIds(text: string, evidenceIds: string[]): string[] {
  const knownEvidenceIds = new Set(evidenceIds);
  return [
    ...new Set(
      Array.from(text.matchAll(/\[(E\d+)\]/g), (match) => match[1]!).filter(
        (evidenceId) => !knownEvidenceIds.has(evidenceId),
      ),
    ),
  ].slice(0, 8);
}
