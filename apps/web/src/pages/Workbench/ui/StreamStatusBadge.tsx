import type { ReactElement } from 'react';
import type { StreamStatus } from '../../../workers/messages';

const STATUS_LABELS: Record<StreamStatus['state'], string> = {
  connecting: 'Connecting',
  live: 'Stream active',
  disconnected: 'Disconnected',
  error: 'Error',
};

interface StreamStatusBadgeProps {
  status: StreamStatus;
}

export default function StreamStatusBadge({
  status,
}: StreamStatusBadgeProps): ReactElement {
  return (
    <span className={`status ${status.state}`} role="status">
      {STATUS_LABELS[status.state]}
    </span>
  );
}
