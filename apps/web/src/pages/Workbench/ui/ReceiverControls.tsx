import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ReceiverModel } from '../model/use-receiver';

interface ReceiverControlsProps {
  receiver: ReceiverModel;
  connected: boolean;
}

export default function ReceiverControls({
  receiver,
  connected,
}: ReceiverControlsProps): ReactElement {
  const settings = receiver.info!.settings;
  const [frequency, setFrequency] = useState(
    String(settings.center_hz / 1_000_000),
  );
  const [sampleRate, setSampleRate] = useState(settings.sample_rate);
  const [gain, setGain] = useState(
    settings.gain_db === null ? 'auto' : String(settings.gain_db),
  );
  const disabled = !connected || receiver.saving;

  return (
    <section className="panel receiver-panel" aria-labelledby="receiver-title">
      <h2 id="receiver-title">RTL-SDR Blog V4</h2>
      <p className="hint">
        {connected
          ? 'This browser owns the dongle while connected. Close the tab to release it.'
          : 'Reconnect to acquire the dongle. Only one browser can own the receiver.'}{' '}
        Tuning briefly restarts capture; other receiver processes must be
        stopped.
      </p>
      <form
        className="receiver-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void receiver.onTune({
            center_hz: Math.round(Number(frequency) * 1_000_000),
            sample_rate: sampleRate,
            gain_db: gain === 'auto' ? null : Number(gain),
          });
        }}
      >
        <label>
          Center frequency (MHz)
          <input
            type="number"
            min={24}
            max={1766}
            step={0.001}
            required
            value={frequency}
            disabled={disabled}
            onChange={(event) => setFrequency(event.target.value)}
          />
        </label>
        <label>
          Capture sample rate
          <select
            value={sampleRate}
            disabled={disabled}
            onChange={(event) => setSampleRate(Number(event.target.value))}
          >
            <option value={240000}>240 kS/s — one FM station</option>
            <option value={1024000}>1.024 MS/s — wider view</option>
            <option value={2400000}>2.4 MS/s — 2.4 MHz band</option>
          </select>
        </label>
        <label>
          Tuner gain
          <select
            value={gain}
            disabled={disabled}
            onChange={(event) => setGain(event.target.value)}
          >
            <option value="auto">Automatic</option>
            {[
              0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7,
              22.9, 25.4, 28, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1,
              43.4, 43.9, 44.5, 48, 49.6,
            ].map((value) => (
              <option key={value} value={value}>
                {value.toFixed(1)} dB
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={disabled}>
          {receiver.saving ? 'Applying…' : 'Apply tuning'}
        </button>
      </form>
      <p className="hint">
        Start near 97.1 MHz or try previously observed stations at 89.7, 93.3,
        98.9 and 101.4 MHz. Sample rate sets the captured band width, not audio
        quality. Gain amplifies everything, including noise; start around 30 dB.
        This stage shows spectrum only; FM audio comes later.
      </p>
      {receiver.error && (
        <p className="error-message" role="alert">
          {receiver.error}
        </p>
      )}
    </section>
  );
}
