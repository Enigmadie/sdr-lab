import { useEffect, useRef, useState } from 'react';
import type {
  SpectrumFrame,
  StreamStatus,
  WorkerCommand,
  WorkerEvent,
} from '../../../workers/messages';
import type { StreamMetrics, WorkbenchViewProps } from '../types';

const METRICS_UPDATE_INTERVAL_MS = 500;

const INITIAL_METRICS: StreamMetrics = {
  processingMs: 0,
  gaps: 0,
  sequence: 0,
  sampleRate: 0,
};

function getStreamUrl(): string {
  const url = new URL('/api/iq', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  return url.href;
}

export function useWorkbenchPage(): WorkbenchViewProps {
  const latestFrame = useRef<SpectrumFrame | null>(null);
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState<StreamStatus>({
    type: 'status',
    state: 'connecting',
  });
  const [metrics, setMetrics] = useState(INITIAL_METRICS);

  useEffect(() => {
    latestFrame.current = null;

    const worker = new Worker(
      new URL('../../../workers/dsp.worker.ts', import.meta.url),
      { type: 'module' },
    );
    let lastMetricsUpdate = 0;

    worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
      if (data.type === 'status') {
        setStatus(data);
        return;
      }

      // High-frequency spectra stay outside React state. Only diagnostics
      // trigger renders, at most twice per second.
      latestFrame.current = data;
      const now = performance.now();

      if (now - lastMetricsUpdate < METRICS_UPDATE_INTERVAL_MS) {
        return;
      }

      setMetrics({
        processingMs: data.processingMs,
        gaps: data.gaps,
        sequence: data.sequence,
        sampleRate: data.sampleRate,
      });
      lastMetricsUpdate = now;
    };

    worker.onerror = () => {
      setStatus({
        type: 'status',
        state: 'error',
        detail: 'The DSP worker failed. Check the WASM build and reload.',
      });
    };

    worker.postMessage({
      type: 'connect',
      url: getStreamUrl(),
    } satisfies WorkerCommand);

    return () => worker.terminate();
  }, [session]);

  function handleReconnect(): void {
    setStatus({ type: 'status', state: 'connecting' });
    setMetrics(INITIAL_METRICS);
    setSession((currentSession) => currentSession + 1);
  }

  return {
    status,
    metrics,
    latestFrame,
    streamSession: session,
    onReconnect: handleReconnect,
  };
}
