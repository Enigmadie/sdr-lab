export interface Recording {
  id: string;
  name: string;
  created_ms: number;
  source: string;
  path: string;
  format: string;
  sample_rate: number;
  center_hz: number;
  gain_db: number | null;
  duration_seconds: number;
  bytes: number;
  blocks: number;
  missing_blocks: number;
  status: string;
  detail: string;
}

export interface RecordingCatalog {
  directory: string;
  max_seconds: number;
  max_bytes: number;
  recordings: Recording[];
  unindexed_files: string[];
}

export interface RecordingCaptureControls {
  error: string | null;
  onStart: (name: string, seconds: number) => void;
  onStop: () => void;
}

export interface RecordingPlaybackControls {
  recordingId: string | null;
  positionSeconds: number;
  isPlaying: boolean;
  onPlay: (id: string, startSeconds: number) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onReturnToCapture: () => void;
}
