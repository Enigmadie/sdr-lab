import type { RefObject } from 'react';
import type { SpectrumFrame, StreamStatus } from '../../workers/messages';

export interface StreamMetrics {
  processingMs: number;
  gaps: number;
  sequence: number;
  sampleRate: number;
}

export interface WorkbenchViewProps {
  status: StreamStatus;
  metrics: StreamMetrics;
  latestFrame: RefObject<SpectrumFrame | null>;
  onReconnect: () => void;
}
