import type { ReactElement } from 'react';

interface FrequencyAxisProps {
  centerHz: number;
  sampleRate: number;
}

export default function FrequencyAxis({
  centerHz,
  sampleRate,
}: FrequencyAxisProps): ReactElement {
  const format = (frequency: number): string =>
    centerHz
      ? `${(frequency / 1_000_000).toFixed(3)} MHz`
      : `${frequency / 1000} kHz`;
  const halfBand = (sampleRate || 48_000) / 2;
  return (
    <div className="frequency-axis">
      <span>{format(centerHz - halfBand)}</span>
      <span>{format(centerHz)}</span>
      <span>{format(centerHz + halfBand)}</span>
    </div>
  );
}
