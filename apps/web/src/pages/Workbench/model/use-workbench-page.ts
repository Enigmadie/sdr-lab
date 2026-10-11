import { useEffect, useRef, useState } from 'react';
import { createSessionId } from '../../../shared/lib/create-session-id';
import { createInitialMetrics } from '../../../workers/initial-metrics';
import type {
  SpectrumFrame,
  StreamStatus,
  WorkerCommand,
  WorkerEvent,
} from '../../../workers/messages';
import type { WorkbenchViewProps } from '../types';
import { useReceiver } from './use-receiver';

function getStreamUrl(ownerId: string): string {
  const url = new URL('/api/iq', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('owner_id', ownerId);

  return url.href;
}

export function useWorkbenchPage(): WorkbenchViewProps {
  const latestFrame = useRef<SpectrumFrame | null>(null);
  const [session, setSession] = useState(0);
  const [ownerId] = useState(createSessionId);
  const receiver = useReceiver(ownerId, session);
  const [status, setStatus] = useState<StreamStatus>({
    type: 'status',
    state: 'connecting',
  });
  const [metrics, setMetrics] = useState(createInitialMetrics);

  useEffect(() => {
    latestFrame.current = null;

    const worker = new Worker(
      new URL('../../../workers/dsp.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
      if (data.type === 'status') {
        setStatus(data);
        return;
      }

      if (data.type === 'metrics') {
        setMetrics(data.metrics);
        worker.postMessage({
          type: 'metrics-consumed',
        } satisfies WorkerCommand);
        return;
      }
      // Spectra stay outside React state; acknowledge mailbox consumption.
      latestFrame.current = data;
      worker.postMessage({ type: 'frame-consumed' } satisfies WorkerCommand);
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
      url: getStreamUrl(ownerId),
    } satisfies WorkerCommand);

    return () => worker.terminate();
  }, [session, ownerId]);

  function handleReconnect(): void {
    setStatus({ type: 'status', state: 'connecting' });
    setMetrics(createInitialMetrics());
    setSession((currentSession) => currentSession + 1);
  }

  return {
    status,
    metrics,
    latestFrame,
    streamSession: session,
    onReconnect: handleReconnect,
    receiver,
  };
}
