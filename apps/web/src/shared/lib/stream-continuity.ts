const HALF_SEQUENCE_RANGE = 0x80000000;

export interface BlockIdentity {
  sequence: number;
  sampleRate: number;
  count: number;
  centerHz?: number;
}

export function inspectContinuity(
  previous: BlockIdentity | undefined,
  current: BlockIdentity,
): { missing: number; reset: boolean; rejected: boolean } {
  if (!previous) {
    return { missing: 0, reset: false, rejected: false };
  }

  const distance = (current.sequence - previous.sequence) >>> 0;
  const rejected = distance === 0 || distance >= HALF_SEQUENCE_RANGE;
  const missing = rejected ? 0 : distance - 1;

  return {
    missing,
    rejected,
    reset:
      rejected ||
      missing > 0 ||
      current.sampleRate !== previous.sampleRate ||
      current.centerHz !== previous.centerHz ||
      current.count !== previous.count,
  };
}
