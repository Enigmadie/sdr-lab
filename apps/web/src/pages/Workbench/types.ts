import type { RefObject } from 'react';
import type {
  SpectrumFrame,
  StreamStatus,
  StreamMetrics,
} from '../../workers/messages';
import type { ReceiverModel } from './model/use-receiver';
import type { RecordingsModel } from './model/use-recordings';
import type {
  RecordingCaptureControls,
  RecordingPlaybackControls,
} from './model/recording-types';
export type { StreamMetrics } from '../../workers/messages';

export interface WorkbenchViewProps {
  receiver: ReceiverModel;
  status: StreamStatus;
  metrics: StreamMetrics;
  latestFrame: RefObject<SpectrumFrame | null>;
  streamSession: number;
  onReconnect: () => void;
  recordings: RecordingsModel;
  capture: RecordingCaptureControls;
  playback: RecordingPlaybackControls;
}
