export type WorkerCommand =
  | { type: 'connect'; url: string }
  | { type: 'stop' }
  | { type: 'metrics-consumed' }
  | { type: 'frame-consumed' };

export interface StreamMetrics {
  processingMs: number;
  maxProcessingMs: number;
  gaps: number;
  discontinuities: number;
  rejectedBlocks: number;
  sequence: number;
  sampleRate: number;
  centerHz: number;
  blockDurationMs: number;
  blocksPerSecond: number;
  bytesPerSecond: number;
  rttMs: number | null;
  lastBlockAgeMs: number | null;
  displayQueueDepth: number;
  coalescedFrames: number;
}

export interface StreamStatus {
  type: 'status';
  state: 'connecting' | 'live' | 'disconnected' | 'error';
  detail?: string;
}

export interface SpectrumFrame {
  type: 'spectrum';
  bins: Float32Array;
  sampleRate: number;
  centerHz: number;
  sequence: number;
  gaps: number;
  processingMs: number;
}

export type WorkerEvent =
  StreamStatus | SpectrumFrame | { type: 'metrics'; metrics: StreamMetrics };
