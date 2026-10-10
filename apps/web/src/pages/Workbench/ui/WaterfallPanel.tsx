import type { ReactElement, RefObject } from 'react';
import { WATERFALL_HISTORY_ROWS } from '../../../gpu/waterfall-renderer';
import type { SpectrumFrame } from '../../../workers/messages';
import { useWaterfall } from '../model/use-waterfall';
import type { WaterfallStatus } from '../model/use-waterfall';

interface WaterfallPanelProps {
  latestFrame: RefObject<SpectrumFrame | null>;
  streamSession: number;
}

function getStatusMessage(status: WaterfallStatus, paused: boolean): string {
  if (status.state === 'ready') {
    return paused
      ? 'Waterfall paused. Signal processing continues.'
      : 'WebGPU active. Newest spectra appear at the top.';
  }

  if (status.state === 'initializing') {
    return 'Initializing WebGPU…';
  }

  return status.detail || 'WebGPU is unavailable.';
}

export default function WaterfallPanel({
  latestFrame,
  streamSession,
}: WaterfallPanelProps): ReactElement {
  const model = useWaterfall(latestFrame, streamSession);
  const isReady = model.status.state === 'ready';
  const canRetry = model.status.state !== 'initializing' && !isReady;

  return (
    <section
      className="panel waterfall-panel"
      aria-labelledby="waterfall-title"
    >
      <div className="panel-heading">
        <div>
          <h2 id="waterfall-title">Signal waterfall</h2>
          <p>
            WebGPU · WGSL color mapping · {WATERFALL_HISTORY_ROWS}-row GPU ring
          </p>
        </div>
        <button
          type="button"
          disabled={!isReady}
          aria-pressed={model.paused}
          onClick={model.onTogglePause}
        >
          {model.paused ? 'Resume waterfall' : 'Pause waterfall'}
        </button>
      </div>

      <div className="waterfall-controls">
        <label>
          Color floor: {model.range.floorDbfs} dBFS
          <input
            type="range"
            min={-120}
            max={model.range.ceilingDbfs - 5}
            step={5}
            value={model.range.floorDbfs}
            onChange={(event) =>
              model.onFloorChange(Number(event.target.value))
            }
          />
        </label>
        <label>
          Color ceiling: {model.range.ceilingDbfs} dBFS
          <input
            type="range"
            min={model.range.floorDbfs + 5}
            max={0}
            step={5}
            value={model.range.ceilingDbfs}
            onChange={(event) =>
              model.onCeilingChange(Number(event.target.value))
            }
          />
        </label>
      </div>

      <div className="waterfall-status" role="status">
        {getStatusMessage(model.status, model.paused)}
        {canRetry && (
          <button type="button" onClick={model.onRetry}>
            Retry GPU
          </button>
        )}
      </div>

      <canvas
        ref={model.canvasRef}
        className="waterfall-canvas"
        aria-label="Waterfall history: frequency left to right, newest spectra at the top, color indicates signal level"
      />
      <div className="frequency-axis">
        <span>−24 kHz</span>
        <span>0</span>
        <span>+24 kHz</span>
      </div>
      <div className="color-legend" aria-label="Signal level color scale">
        <span>{model.range.floorDbfs} dBFS</span>
        <div className="color-gradient" />
        <span>{model.range.ceilingDbfs} dBFS</span>
      </div>
      <p className="hint">
        Two fixed tones make vertical tracks. A sweeping tone makes a moving
        track, and a short burst appears every two seconds. Each row is one
        displayed spectrum, not a fixed wall-clock interval; inactive tabs may
        skip spectra. Pause freezes only this history. Reconnect clears it.
      </p>
      {!isReady && model.status.state !== 'initializing' && (
        <p className="hint">
          The CPU spectrum and WASM processing above remain available without
          WebGPU.
        </p>
      )}
    </section>
  );
}
