export type WorkerCommand = { type: 'connect'; url: string } | { type: 'stop' };

export interface StreamStatus {
  type: 'status';
  state: 'connecting' | 'live' | 'disconnected' | 'error';
  detail?: string;
}

export interface SpectrumFrame {
  type: 'spectrum';
  bins: Float32Array;
  sampleRate: number;
  sequence: number;
  gaps: number;
  processingMs: number;
}

export type WorkerEvent = StreamStatus | SpectrumFrame;
