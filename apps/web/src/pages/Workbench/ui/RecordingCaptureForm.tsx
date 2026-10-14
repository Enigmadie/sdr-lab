import { useState } from 'react';
import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import type { RecordingCaptureControls } from '../model/recording-types';
import {
  DEFAULT_RECORDING_NAME,
  DEFAULT_RECORDING_SECONDS,
  MAX_RECORDING_NAME_LENGTH,
} from '../model/recording-constants';

interface RecordingCaptureFormProps {
  controls: RecordingCaptureControls;
  canRecord: boolean;
  canStop: boolean;
  maxSeconds: number;
}

export default function RecordingCaptureForm({
  controls,
  canRecord,
  canStop,
  maxSeconds,
}: RecordingCaptureFormProps): ReactElement {
  const [name, setName] = useState(DEFAULT_RECORDING_NAME);
  const [durationSeconds, setDurationSeconds] = useState(
    DEFAULT_RECORDING_SECONDS,
  );

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
  }

  function handleDurationChange(event: ChangeEvent<HTMLInputElement>): void {
    setDurationSeconds(Number(event.target.value));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    controls.onStart(name, durationSeconds);
  }

  return (
    <>
      <form className="recording-actions" onSubmit={handleSubmit}>
        <label>
          Recording name
          <input
            value={name}
            maxLength={MAX_RECORDING_NAME_LENGTH}
            onChange={handleNameChange}
            required
          />
        </label>

        <label>
          Duration (seconds)
          <input
            type="number"
            min={1}
            max={maxSeconds}
            value={durationSeconds}
            onChange={handleDurationChange}
            required
          />
        </label>

        <button type="submit" disabled={!canRecord}>
          Record capture
        </button>

        <button type="button" onClick={controls.onStop} disabled={!canStop}>
          Stop recording
        </button>
      </form>

      <p className="hint">
        Recording saves full capture blocks, not just FFT snapshots. Retuning or
        disconnecting stops the recording. Disk backpressure stops recording
        rather than building an unbounded queue.
      </p>
    </>
  );
}
