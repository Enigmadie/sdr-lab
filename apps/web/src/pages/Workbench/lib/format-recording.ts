import type { Recording } from '../model/recording-types';

const BYTES_PER_MEGABYTE = 1_000_000;
const HERTZ_PER_MEGAHERTZ = 1_000_000;

export function formatRecordingSize(bytes: number, fractionDigits = 2): string {
  return `${(bytes / BYTES_PER_MEGABYTE).toFixed(fractionDigits)} MB`;
}

export function formatRecordingDuration(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

export function formatRecordingSummary(recording: Recording): string {
  return [
    new Date(recording.created_ms).toLocaleString(),
    recording.source,
    formatRecordingDuration(recording.duration_seconds),
    formatRecordingSize(recording.bytes),
  ].join(' · ');
}

export function formatRecordingSettings(recording: Recording): string {
  const frequencyLabel =
    recording.center_hz === 0
      ? 'Baseband'
      : `${(recording.center_hz / HERTZ_PER_MEGAHERTZ).toFixed(3)} MHz`;
  const sampleRateLabel = `${(recording.sample_rate / HERTZ_PER_MEGAHERTZ).toFixed(3)} MS/s`;
  const gainLabel =
    recording.gain_db === null
      ? 'Gain automatic / not applicable'
      : `Gain ${recording.gain_db} dB`;

  return [frequencyLabel, sampleRateLabel, recording.format, gainLabel].join(
    ' · ',
  );
}
