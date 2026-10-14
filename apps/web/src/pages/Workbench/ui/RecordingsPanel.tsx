import type { ReactElement } from 'react';
import type {
  RecordingCaptureControls,
  RecordingPlaybackControls as PlaybackControls,
} from '../model/recording-types';
import type { RecordingsModel } from '../model/use-recordings';
import { DEFAULT_MAX_RECORDING_SECONDS } from '../model/recording-constants';
import RecordingCaptureForm from './RecordingCaptureForm';
import RecordingCatalogList from './RecordingCatalogList';
import RecordingPlaybackControls from './RecordingPlaybackControls';
import RecordingStorageSummary from './RecordingStorageSummary';

interface RecordingsPanelProps {
  recordings: RecordingsModel;
  capture: RecordingCaptureControls;
  playback: PlaybackControls;
  isConnected: boolean;
}

export default function RecordingsPanel({
  recordings,
  capture,
  playback,
  isConnected,
}: RecordingsPanelProps): ReactElement {
  const catalog = recordings.catalog;
  const hasActiveRecording =
    catalog?.recordings.some((recording) => recording.status === 'recording') ??
    false;
  const selectedRecording =
    catalog?.recordings.find(
      (recording) => recording.id === playback.recordingId,
    ) ?? null;
  const isReplaying = playback.recordingId !== null;
  const canRecord =
    isConnected && !isReplaying && !hasActiveRecording && catalog !== null;
  const canStopRecording = isConnected && !isReplaying && hasActiveRecording;
  const maxSeconds = catalog?.max_seconds ?? DEFAULT_MAX_RECORDING_SECONDS;
  const error = capture.error ?? recordings.error;

  return (
    <section className="panel recordings-panel" aria-label="Recordings">
      <div className="panel-heading">
        <div>
          <h2>Recordings</h2>
          <p>
            Reusable I/Q fixtures for FFT and DSP experiments. Files are stored
            on the server.
          </p>
        </div>

        <button onClick={recordings.onRefresh}>Refresh catalog</button>
      </div>

      {catalog && <RecordingStorageSummary catalog={catalog} />}

      <RecordingCaptureForm
        controls={capture}
        canRecord={canRecord}
        canStop={canStopRecording}
        maxSeconds={maxSeconds}
      />

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {isReplaying && (
        <RecordingPlaybackControls
          key={playback.recordingId}
          controls={playback}
          recording={selectedRecording}
        />
      )}

      {catalog && (
        <RecordingCatalogList
          catalog={catalog}
          selectedRecordingId={playback.recordingId}
          hasActiveRecording={hasActiveRecording}
          isMutating={recordings.busy}
          onPlay={playback.onPlay}
          onRename={recordings.onRename}
          onDelete={recordings.onDelete}
        />
      )}
    </section>
  );
}
