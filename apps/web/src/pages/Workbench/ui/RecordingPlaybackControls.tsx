import { useState } from 'react';
import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { formatRecordingDuration } from '../lib/format-recording';
import type {
  Recording,
  RecordingPlaybackControls as PlaybackControls,
} from '../model/recording-types';

const SEEK_STEP_SECONDS = 0.1;

interface RecordingPlaybackControlsProps {
  controls: PlaybackControls;
  recording: Recording | null;
}

export default function RecordingPlaybackControls({
  controls,
  recording,
}: RecordingPlaybackControlsProps): ReactElement {
  const [seekSeconds, setSeekSeconds] = useState(0);
  const recordingName = recording?.name ?? controls.recordingId;
  const durationLabel =
    recording === null
      ? '?'
      : formatRecordingDuration(recording.duration_seconds);
  const positionLabel = formatRecordingDuration(controls.positionSeconds);

  function handleSeekChange(event: ChangeEvent<HTMLInputElement>): void {
    setSeekSeconds(Number(event.target.value));
  }

  function handleSeekSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (controls.recordingId !== null) {
      controls.onPlay(controls.recordingId, seekSeconds);
    }
  }

  return (
    <div className="playback-controls">
      <h3>Replay: {recordingName}</h3>

      <p className="hint">
        {positionLabel} / {durationLabel}
      </p>

      <p className="hint">
        Recorded data → current WASM FFT → spectrum / waterfall. Slow DSP
        stretches playback without dropping saved blocks.
      </p>

      <div className="recording-actions">
        <button onClick={controls.onPause} disabled={!controls.isPlaying}>
          Pause replay
        </button>

        <button onClick={controls.onResume} disabled={controls.isPlaying}>
          Resume replay
        </button>

        <button onClick={controls.onRestart}>Restart replay</button>

        <button onClick={controls.onReturnToCapture}>Return to capture</button>
      </div>

      <form className="recording-actions" onSubmit={handleSeekSubmit}>
        <label>
          Seek to second
          <input
            type="number"
            min={0}
            max={recording?.duration_seconds ?? 0}
            step={SEEK_STEP_SECONDS}
            value={seekSeconds}
            onChange={handleSeekChange}
          />
        </label>

        <button type="submit">Seek</button>
      </form>
    </div>
  );
}
