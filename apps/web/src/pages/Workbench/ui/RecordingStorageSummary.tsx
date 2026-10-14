import type { ReactElement } from 'react';
import { formatRecordingSize } from '../lib/format-recording';
import type { RecordingCatalog } from '../model/recording-types';

interface RecordingStorageSummaryProps {
  catalog: RecordingCatalog;
}

export default function RecordingStorageSummary({
  catalog,
}: RecordingStorageSummaryProps): ReactElement {
  const totalBytes = catalog.recordings.reduce(
    (total, recording) => total + recording.bytes,
    0,
  );
  const storageLabel = formatRecordingSize(totalBytes);
  const sizeLimitLabel = formatRecordingSize(catalog.max_bytes, 0);
  const serverEndpoint = window.location.host;

  return (
    <div className="hint">
      <p>
        Server: {serverEndpoint} · {storageLabel} stored
      </p>

      <p>
        Limit: {catalog.max_seconds} s / {sizeLimitLabel} per recording
      </p>

      <code className="storage-path">{catalog.directory}</code>
    </div>
  );
}
