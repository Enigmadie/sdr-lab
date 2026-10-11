import type { RefObject } from 'react';
import type {
  SpectrumFrame,
  StreamStatus,
  StreamMetrics,
} from '../../workers/messages';
import type { ReceiverModel } from './model/use-receiver';
export type { StreamMetrics } from '../../workers/messages';

export interface WorkbenchViewProps {
  receiver: ReceiverModel;
  status: StreamStatus;
  metrics: StreamMetrics;
  latestFrame: RefObject<SpectrumFrame | null>;
  streamSession: number;
  onReconnect: () => void;
}
