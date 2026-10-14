import type { ReactElement } from 'react';
import type {
  RecordingCatalog,
  RecordingPlaybackControls,
} from '../model/recording-types';
import type { RecordingsModel } from '../model/use-recordings';
import RecordingCard from './RecordingCard';

interface RecordingCatalogListProps {
  catalog: RecordingCatalog;
  selectedRecordingId: string | null;
  hasActiveRecording: boolean;
  isMutating: boolean;
  onPlay: RecordingPlaybackControls['onPlay'];
  onRename: RecordingsModel['onRename'];
  onDelete: RecordingsModel['onDelete'];
}

export default function RecordingCatalogList({
  catalog,
  selectedRecordingId,
  hasActiveRecording,
  isMutating,
  onPlay,
  onRename,
  onDelete,
}: RecordingCatalogListProps): ReactElement {
  const isEmpty = catalog.recordings.length === 0;
  const hasUnindexedFiles = catalog.unindexed_files.length > 0;

  return (
    <>
      {isEmpty && (
        <p className="hint">
          No recordings yet. Capture a short signal to create your first
          reusable fixture.
        </p>
      )}

      {hasUnindexedFiles && (
        <div role="alert">
          <p className="error-message">
            Files without readable metadata are still on disk and cannot be
            replayed from this catalog:
          </p>

          {catalog.unindexed_files.map((file) => (
            <code key={file} className="storage-path">
              {file}
            </code>
          ))}
        </div>
      )}

      <div className="recording-list">
        {catalog.recordings.map((recording) => (
          <RecordingCard
            key={recording.id}
            recording={recording}
            isSelected={recording.id === selectedRecordingId}
            hasActiveRecording={hasActiveRecording}
            isMutating={isMutating}
            onPlay={onPlay}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    </>
  );
}
