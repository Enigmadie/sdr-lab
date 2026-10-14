import type { RecordingCatalog } from '../model/recording-types';

const RECORDINGS_ENDPOINT = '/api/recordings';

async function requireSuccessfulResponse(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function getRecordingEndpoint(recordingId: string): string {
  return `${RECORDINGS_ENDPOINT}/${encodeURIComponent(recordingId)}`;
}

export async function fetchRecordingCatalog(
  signal: AbortSignal,
): Promise<RecordingCatalog> {
  const response = await fetch(RECORDINGS_ENDPOINT, { signal });

  await requireSuccessfulResponse(response);

  return (await response.json()) as RecordingCatalog;
}

export async function renameRecording(
  recordingId: string,
  name: string,
): Promise<void> {
  const response = await fetch(getRecordingEndpoint(recordingId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  await requireSuccessfulResponse(response);
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const response = await fetch(getRecordingEndpoint(recordingId), {
    method: 'DELETE',
  });

  await requireSuccessfulResponse(response);
}
