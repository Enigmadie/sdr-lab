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
          <span>DSP processing / peak</span>
          <strong>
            {metrics.processingMs.toFixed(2)} /{' '}
            {metrics.maxProcessingMs.toFixed(2)} ms
          </strong>
        </article>
        <article>
          <span>Block time budget</span>
          <strong>{metrics.blockDurationMs.toFixed(2)} ms</strong>
        </article>
        <article>
          <span>WebSocket RTT</span>
          <strong>
            {metrics.rttMs === null ? '—' : `${metrics.rttMs.toFixed(2)} ms`}
          </strong>
        </article>
        <article>
          <span>Received throughput</span>
          <strong>
            {(metrics.bytesPerSecond / 1_000_000).toFixed(3)} MB/s
          </strong>
        </article>
        <article>
          <span>Received blocks</span>
          <strong>{metrics.blocksPerSecond.toFixed(1)} /s</strong>
        </article>
        <article>
          <span>Last block age</span>
          <strong>
            {metrics.lastBlockAgeMs === null
              ? '—'
              : `${metrics.lastBlockAgeMs.toFixed(0)} ms`}
          </strong>
        </article>
        <article>
          <span>Block sequence</span>
          <strong>{metrics.sequence}</strong>
        </article>
        <article>
          <span>Dropped blocks</span>
          <strong>{metrics.gaps}</strong>
        </article>
        <article>
          <span>DSP discontinuities</span>
          <strong>{metrics.discontinuities}</strong>
        </article>
        <article>
          <span>Rejected sequence blocks</span>
          <strong>{metrics.rejectedBlocks}</strong>
        </article>
        <article>
          <span>Display queue / limit</span>
          <strong>{metrics.displayQueueDepth} / 2</strong>
        </article>
        <article>
          <span>Coalesced display frames</span>
          <strong>{metrics.coalescedFrames}</strong>
        </article>
      </section>
      <p className="hint">
        DSP time includes decoding and WASM FFT, excluding network and
        rendering. RTT is an application ping round trip, not capture-to-screen
        latency. The server allows one unacknowledged I/Q block; slow processing
        skips source blocks instead of building a backlog. Display coalescing
        replaces old spectra and is separate from I/Q loss. Counters reset on
        reconnect.
      </p>
    </>
  );
}
