export function getStreamUrl(
  ownerId: string,
  recordingId: string | null,
  startSeconds: number,
): string {
  const pathname =
    recordingId === null
      ? '/api/iq'
      : `/api/recordings/${encodeURIComponent(recordingId)}/replay`;
  const url = new URL(pathname, window.location.href);

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('owner_id', ownerId);
  url.searchParams.set('start', String(startSeconds));

  return url.href;
}
