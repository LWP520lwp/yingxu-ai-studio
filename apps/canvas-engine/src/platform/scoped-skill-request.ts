export type SkillRequestTicket = {
  scopeId: string;
  revision: number;
  key?: string;
  signal?: AbortSignal;
};

export type SkillRequestSnapshot = {
  scopeId: string | null;
  revision: number;
  key?: string;
};

export function isCurrentSkillRequest(
  ticket: SkillRequestTicket,
  snapshot: SkillRequestSnapshot,
): boolean {
  return (
    !ticket.signal?.aborted &&
    ticket.scopeId === snapshot.scopeId &&
    ticket.revision === snapshot.revision &&
    (ticket.key === undefined || ticket.key === snapshot.key)
  );
}

export function skillRequestErrorMessage(
  cause: unknown,
  fallback: string,
): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
