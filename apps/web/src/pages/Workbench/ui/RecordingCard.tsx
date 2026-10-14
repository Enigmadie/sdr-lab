import { useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import {
  formatRecordingSettings,
  formatRecordingSummary,
} from '../lib/format-recording';
import type {
  Recording,
  RecordingPlaybackControls,
} from '../model/recording-types';
import type { RecordingsModel } from '../model/use-recordings';
import { MAX_RECORDING_NAME_LENGTH } from '../model/recording-constants';

interface RecordingCardProps {
  recording: Recording;
  isSelected: boolean;
  hasActiveRecording: boolean;
  isMutating: boolean;
  onPlay: RecordingPlaybackControls['onPlay'];
  onRename: RecordingsModel['onRename'];
  onDelete: RecordingsModel['onDelete'];
}

export default function RecordingCard({
  recording,
  isSelected,
  hasActiveRecording,
  isMutating,
  onPlay,
  onRename,
  onDelete,
}: RecordingCardProps): ReactElement {
  const [name, setName] = useState(recording.name);
  const [isDeleteConfirmationVisible, setDeleteConfirmationVisible] =
    useState(false);
  const isRecording = recording.status === 'recording';
  const isEditingDisabled = isRecording || isMutating;
  const isPlayDisabled =
    hasActiveRecording || isRecording || recording.bytes === 0;
  const isRenameDisabled =
    isEditingDisabled || !name.trim() || name === recording.name;
  const isDeleteDisabled = isEditingDisabled || isSelected;
  const className = isSelected ? 'recording-card selected' : 'recording-card';
  const summaryLabel = formatRecordingSummary(recording);
  const settingsLabel = formatRecordingSettings(recording);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
  }

  function handlePlay(): void {
    onPlay(recording.id, 0);
  }

  function handleRename(): void {
    void onRename(recording.id, name);
  }

  function handleConfirmDelete(): void {
    void onDelete(recording.id);
  }

  function handleRequestDelete(): void {
    setDeleteConfirmationVisible(true);
  }

  function handleCancelDelete(): void {
    setDeleteConfirmationVisible(false);
  }

  return (
    <article className={className}>
      <div className="panel-heading">
        <h3>{recording.name}</h3>
        <span className="status">{recording.status}</span>
      </div>

      <p className="hint">{summaryLabel}</p>

      <p className="hint">{settingsLabel}</p>

      <p className="hint">
        {recording.blocks} blocks · {recording.missing_blocks} missing capture
        blocks
      </p>

      <code className="storage-path">{recording.path}</code>

      {recording.detail && <p className="hint">{recording.detail}</p>}

      <div className="recording-actions">
        <button onClick={handlePlay} disabled={isPlayDisabled}>
          Play from start
        </button>

        <label>
          <span className="visually-hidden">Rename {recording.name}</span>
          <input
            value={name}
            maxLength={MAX_RECORDING_NAME_LENGTH}
            onChange={handleNameChange}
            disabled={isEditingDisabled}
          />
        </label>

        <button onClick={handleRename} disabled={isRenameDisabled}>
          Rename
        </button>

        {isDeleteConfirmationVisible ? (
          <>
            <button onClick={handleConfirmDelete} disabled={isDeleteDisabled}>
              Confirm delete file
            </button>

            <button onClick={handleCancelDelete}>Cancel</button>
          </>
        ) : (
          <button onClick={handleRequestDelete} disabled={isDeleteDisabled}>
            Delete
          </button>
        )}
      </div>
    </article>
  );
}
