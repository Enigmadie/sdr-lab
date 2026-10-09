import type { ReactElement } from 'react';
import type { WorkbenchViewProps } from '../types';
import Diagnostics from './Diagnostics';
import SpectrumPanel from './SpectrumPanel';
import StreamStatusBadge from './StreamStatusBadge';

export default function WorkbenchView({
  status,
  metrics,
  latestFrame,
  onReconnect,
}: WorkbenchViewProps): ReactElement {
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">RADIO WORKBENCH / BOOTSTRAP</p>
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

      <footer>
        Next: WebGPU waterfall → RTL-SDR capture → recording and replay → FM
        audio. GPU processing is not enabled yet.
      </footer>
    </main>
  );
}
