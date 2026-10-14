import { useState } from 'react';
import { createSessionId } from '../../../shared/lib/create-session-id';
import type { WorkbenchViewProps } from '../types';
import { useReceiver } from './use-receiver';
import { useRecordings } from './use-recordings';
import { useSignalStream } from './use-signal-stream';

export function useWorkbenchPage(): WorkbenchViewProps {
  const [ownerId] = useState(createSessionId);
  const [session, setSession] = useState(0);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [playbackStart, setPlaybackStart] = useState(0);
  const receiver = useReceiver(ownerId, session);
  const recordings = useRecordings();
  const stream = useSignalStream({
    ownerId,
    recordingId,
    startSeconds: playbackStart,
    session,
  });

  function handleReconnect(): void {
    stream.prepareConnection(playbackStart);
    setSession((currentSession) => currentSession + 1);
  }

  function handlePlay(id: string, startSeconds: number): void {
    setRecordingId(id);
    setPlaybackStart(startSeconds);
    stream.prepareConnection(startSeconds);
    setSession((currentSession) => currentSession + 1);
  }

  function handleReturnToCapture(): void {
    setRecordingId(null);
    setPlaybackStart(0);
    stream.prepareConnection();
    setSession((currentSession) => currentSession + 1);
  }

  function handleResume(): void {
    if (recordingId !== null) {
      handlePlay(recordingId, stream.playbackPosition);
    }
  }

  function handleRestart(): void {
    if (recordingId !== null) {
      handlePlay(recordingId, 0);
    }
  }

  return {
    status: stream.status,
    metrics: stream.metrics,
    latestFrame: stream.latestFrame,
    streamSession: session,
    receiver,
    recordings,
    onReconnect: handleReconnect,
    capture: {
      error: stream.recordError,
      onStart: stream.startRecording,
      onStop: stream.stopRecording,
    },
    playback: {
      recordingId,
      positionSeconds: stream.playbackPosition,
      isPlaying: stream.status.state === 'live',
      onPlay: handlePlay,
      onPause: stream.pausePlayback,
      onResume: handleResume,
      onRestart: handleRestart,
      onReturnToCapture: handleReturnToCapture,
    },
  };
}
