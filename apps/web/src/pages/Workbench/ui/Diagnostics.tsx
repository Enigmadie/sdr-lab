import type { ReactElement } from 'react';
import type { StreamMetrics } from '../types';

interface DiagnosticsProps {
  metrics: StreamMetrics;
}

export default function Diagnostics({
  metrics,
}: DiagnosticsProps): ReactElement {
  const sampleRateLabel = metrics.sampleRate
    ? `${metrics.sampleRate / 1000} kS/s`
    : '—';

  return (
    <>
      <section className="metrics" aria-label="Stream diagnostics">
        <article>
          <span>Sample rate</span>
          <strong>{sampleRateLabel}</strong>
        </article>
        <article>
          <span>Block processing*</span>
          <strong>{metrics.processingMs.toFixed(2)} ms</strong>
        </article>
        <article>
          <span>Block sequence</span>
          <strong>{metrics.sequence}</strong>
        </article>
        <article>
          <span>Dropped blocks</span>
          <strong>{metrics.gaps}</strong>
        </article>
      </section>
      <p className="hint">
        * Block decoding and WASM FFT in the worker. Network and rendering time
        are not included.
      </p>
    </>
  );
}
