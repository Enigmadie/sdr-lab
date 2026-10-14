import type { ReactElement } from 'react';
import type { WorkbenchViewProps } from '../types';
import Diagnostics from './Diagnostics';
import ReceiverControls from './ReceiverControls';
import RecordingsPanel from './RecordingsPanel';
import SpectrumPanel from './SpectrumPanel';
import StreamStatusBadge from './StreamStatusBadge';
import WaterfallPanel from './WaterfallPanel';

function getWorkbenchDescription(
  isReplaying: boolean,
  source: string | undefined,
): string {
  if (isReplaying) {
    return 'Replaying saved I/Q through the current DSP pipeline. No receiver is opened for replay.';
  }

  if (source === 'rtlsdr') {
    return 'Live RTL-SDR capture. The spectrum shows the band around the tuned center frequency; your browser processes and renders the signal.';
  }

  return 'A browser workbench for radio signal processing. This session uses a synthetic source; no RTL-SDR hardware is connected.';
}

export default function WorkbenchView({
  status,
  metrics,
  latestFrame,
  streamSession,
  onReconnect,
  receiver,
  recordings,
  capture,
  playback,
}: WorkbenchViewProps): ReactElement {
  const isReplaying = playback.recordingId !== null;
  const isConnected = status.state === 'live';
  const isStreamError = status.state === 'error';
  const description = getWorkbenchDescription(
    isReplaying,
    receiver.info?.source,
  );
  const showReceiverControls =
    !isReplaying && receiver.info?.source === 'rtlsdr';

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">RADIO WORKBENCH / WASM + WEBGPU</p>
          <h1>SDR Lab</h1>
        </div>
        <StreamStatusBadge status={status} />
      </header>

      <p className="intro">{description}</p>

      {showReceiverControls && (
        <ReceiverControls
          key={streamSession}
          receiver={receiver}
          connected={isConnected}
        />
      )}
      {receiver.error && receiver.info?.source !== 'rtlsdr' && (
        <p className="error-message" role="alert">
          {receiver.error}
        </p>
      )}

      <SpectrumPanel
        latestFrame={latestFrame}
        onReconnect={onReconnect}
        metrics={metrics}
      />

      {status.detail && (
        <p
          className={isStreamError ? 'error-message' : 'hint'}
          role={isStreamError ? 'alert' : 'status'}
        >
          {status.detail}
        </p>
      )}

      <Diagnostics metrics={metrics} />

      <WaterfallPanel
        latestFrame={latestFrame}
        streamSession={streamSession}
        metrics={metrics}
      />

      <RecordingsPanel
        recordings={recordings}
        capture={capture}
        playback={playback}
        isConnected={isConnected}
      />
      <footer>
        FFT runs in Rust/WASM; waterfall rendering runs on WebGPU when
        available. Next: mono FM audio.
      </footer>
    </main>
  );
}
