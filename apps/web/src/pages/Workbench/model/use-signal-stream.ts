import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createInitialMetrics } from '../../../workers/initial-metrics';
import type {
  SpectrumFrame,
  StreamMetrics,
  StreamStatus,
  WorkerCommand,
  WorkerEvent,
} from '../../../workers/messages';
import { getStreamUrl } from '../lib/get-stream-url';

const WORKER_CLOSE_GRACE_MS = 100;

interface SignalStreamOptions {
  ownerId: string;
  recordingId: string | null;
  startSeconds: number;
  session: number;
}

interface SignalStreamModel {
  latestFrame: RefObject<SpectrumFrame | null>;
  status: StreamStatus;
  metrics: StreamMetrics;
  playbackPosition: number;
  recordError: string | null;
  prepareConnection: (positionSeconds?: number) => void;
  startRecording: (name: string, seconds: number) => void;
  stopRecording: () => void;
  pausePlayback: () => void;
}

export function useSignalStream({
  ownerId,
  recordingId,
  startSeconds,
  session,
}: SignalStreamOptions): SignalStreamModel {
  const latestFrame = useRef<SpectrumFrame | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<StreamStatus>({
    type: 'status',
    state: 'connecting',
  });
  const [metrics, setMetrics] = useState(createInitialMetrics);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    latestFrame.current = null;

    const worker = new Worker(
      new URL('../../../workers/dsp.worker.ts', import.meta.url),
      { type: 'module' },
    );

    workerRef.current = worker;

    function handleWorkerMessage({ data }: MessageEvent<WorkerEvent>): void {
      switch (data.type) {
        case 'playback-position':
          setPlaybackPosition(data.seconds);
          worker.postMessage({
            type: 'playback-position-consumed',
          } satisfies WorkerCommand);
          break;
        case 'record-error':
          setRecordError(data.detail);
          break;
        case 'status':
          setStatus(data);
          break;
        case 'metrics':
          setMetrics(data.metrics);
          worker.postMessage({
            type: 'metrics-consumed',
          } satisfies WorkerCommand);
          break;
        case 'spectrum':
          // Spectra stay outside React state; acknowledge mailbox consumption.
          latestFrame.current = data;
          worker.postMessage({
            type: 'frame-consumed',
          } satisfies WorkerCommand);
          break;
      }
    }

    function handleWorkerError(): void {
      setStatus({
        type: 'status',
        state: 'error',
        detail: 'The DSP worker failed. Check the WASM build and reload.',
      });
    }

    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
    worker.postMessage({
      type: 'connect',
      url: getStreamUrl(ownerId, recordingId, startSeconds),
    } satisfies WorkerCommand);

    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.postMessage({ type: 'stop' } satisfies WorkerCommand);
      // Allow the worker to close its WebSocket and release capture ownership.
      setTimeout(() => worker.terminate(), WORKER_CLOSE_GRACE_MS);
      workerRef.current = null;
    };
  }, [session, ownerId, recordingId, startSeconds]);

  function prepareConnection(positionSeconds = 0): void {
    setStatus({ type: 'status', state: 'connecting' });
    setMetrics(createInitialMetrics());
    setPlaybackPosition(positionSeconds);
  }

  function startRecording(name: string, seconds: number): void {
    setRecordError(null);
    workerRef.current?.postMessage({
      type: 'record',
      name,
      seconds,
    } satisfies WorkerCommand);
  }

  function stopRecording(): void {
    workerRef.current?.postMessage({
      type: 'record-stop',
    } satisfies WorkerCommand);
  }

  function pausePlayback(): void {
    workerRef.current?.postMessage({ type: 'stop' } satisfies WorkerCommand);
    setStatus({
      type: 'status',
      state: 'disconnected',
      detail: 'Playback paused.',
    });
  }

  return {
    latestFrame,
    status,
    metrics,
    playbackPosition,
    recordError,
    prepareConnection,
    startRecording,
    stopRecording,
    pausePlayback,
  };
}
