export interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

export function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  const parts = sessionKey.split(':');
  if (parts[0] !== 'agent' || parts[2] !== 'cron') return null;

  const agentId = parts[1];
  const jobId = parts[3];
  if (!agentId?.trim() || !jobId?.trim()) return null;

  if (parts.length === 4) return { agentId, jobId };
  if (parts.length !== 6 || parts[4] !== 'run') return null;

  const runSessionId = parts[5];
  return runSessionId?.trim() ? { agentId, jobId, runSessionId } : null;
}

export function isCronSessionKey(sessionKey: string): boolean {
  return parseCronSessionKey(sessionKey) != null;
}

export function isRunScopedCronSessionKey(sessionKey: string): boolean {
  return parseCronSessionKey(sessionKey)?.runSessionId != null;
}

export function getCronSessionBaseKey(sessionKey: string): string {
  const parts = parseCronSessionKey(sessionKey);
  if (!parts) return sessionKey;
  return `agent:${parts.agentId}:cron:${parts.jobId}`;
}

export function sessionKeysAreEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const parsedA = parseCronSessionKey(a);
  const parsedB = parseCronSessionKey(b);
  if (!parsedA || !parsedB) return false;
  return parsedA.agentId === parsedB.agentId && parsedA.jobId === parsedB.jobId;
}
