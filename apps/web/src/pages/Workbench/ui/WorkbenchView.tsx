import type { ReactElement } from 'react';
import type { WorkbenchViewProps } from '../types';
import Diagnostics from './Diagnostics';
import SpectrumPanel from './SpectrumPanel';
import StreamStatusBadge from './StreamStatusBadge';
import WaterfallPanel from './WaterfallPanel';

export default function WorkbenchView({
  status,
  metrics,
  latestFrame,
  streamSession,
  onReconnect,
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
        A browser workbench for radio signal processing. This session uses a
        synthetic source; no RTL-SDR hardware is connected.
      </p>

      <SpectrumPanel latestFrame={latestFrame} onReconnect={onReconnect} />

      {status.detail && (
        <p className="error-message" role="alert">
          {status.detail}
        </p>
      )}

      <Diagnostics metrics={metrics} />

      <WaterfallPanel latestFrame={latestFrame} streamSession={streamSession} />

      <footer>
        FFT runs in Rust/WASM; waterfall rendering runs on WebGPU when
        available. Next: RTL-SDR capture → recording and replay → FM audio.
      </footer>
    </main>
  );
}
