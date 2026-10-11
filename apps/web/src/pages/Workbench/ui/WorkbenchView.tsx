import type { ReactElement } from 'react';
import type { WorkbenchViewProps } from '../types';
import Diagnostics from './Diagnostics';
import ReceiverControls from './ReceiverControls';
import SpectrumPanel from './SpectrumPanel';
import StreamStatusBadge from './StreamStatusBadge';
import WaterfallPanel from './WaterfallPanel';

export default function WorkbenchView({
  status,
  metrics,
  latestFrame,
  streamSession,
  onReconnect,
  receiver,
}: WorkbenchViewProps): ReactElement {
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">RADIO WORKBENCH / WASM + WEBGPU</p>
          <h1>SDR Lab</h1>
        </div>
        <StreamStatusBadge status={status} />
      </header>

      <p className="intro">
        {receiver.info?.source === 'rtlsdr'
          ? 'Live RTL-SDR capture. The spectrum shows the band around the tuned center frequency; your browser processes and renders the signal.'
          : 'A browser workbench for radio signal processing. This session uses a synthetic source; no RTL-SDR hardware is connected.'}
      </p>
      {receiver.info?.source === 'rtlsdr' && (
        <ReceiverControls
          key={streamSession}
          receiver={receiver}
          connected={status.state === 'live'}
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
        <p className="error-message" role="alert">
          {status.detail}
        </p>
      )}

      <Diagnostics metrics={metrics} />

      <WaterfallPanel
        latestFrame={latestFrame}
        streamSession={streamSession}
        metrics={metrics}
      />

      <footer>
        FFT runs in Rust/WASM; waterfall rendering runs on WebGPU when
        available. Next: recording and replay → FM audio.
      </footer>
    </main>
  );
}
