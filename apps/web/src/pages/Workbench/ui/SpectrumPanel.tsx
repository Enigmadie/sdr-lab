import type { ReactElement, RefObject } from 'react';
import type { SpectrumFrame } from '../../../workers/messages';
import { useSpectrumCanvas } from '../model/use-spectrum-canvas';

interface SpectrumPanelProps {
  latestFrame: RefObject<SpectrumFrame | null>;
  onReconnect: () => void;
}

export default function SpectrumPanel({
  latestFrame,
  onReconnect,
}: SpectrumPanelProps): ReactElement {
  const canvasRef = useSpectrumCanvas(latestFrame);

  return (
    <section className="panel" aria-labelledby="spectrum-title">
      <div className="panel-heading">
        <div>
          <h2 id="spectrum-title">Signal spectrum</h2>
          <p>Rust/WASM FFT · Web Worker · Canvas 2D</p>
        </div>
        <button type="button" onClick={onReconnect}>
          Reconnect
        </button>
      </div>

      <div className="plot">
        <span className="axis-label">0 … −100 dBFS</span>
        <canvas
          ref={canvasRef}
          aria-label="Synthetic signal spectrum with peaks at −10.5 and +6 kHz"
        />
      </div>

      <div className="frequency-axis">
        <span>−24 kHz</span>
        <span>0</span>
        <span>+24 kHz</span>
      </div>
      <p className="hint">
        Fixed tones at −10.5 and +6 kHz, a sweeping tone and periodic bursts.
        Frequencies are relative to the center of the captured band.
      </p>
    </section>
  );
}
