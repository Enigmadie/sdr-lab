import { useCallback, useEffect, useState } from 'react';

export interface ReceiverSettings {
  center_hz: number;
  sample_rate: number;
  gain_db: number | null;
}

interface ServerStatus {
  source: 'synthetic' | 'rtlsdr';
  device_busy: boolean;
  settings: ReceiverSettings;
}

export interface ReceiverModel {
  info: ServerStatus | null;
  error: string | null;
  saving: boolean;
  onTune: (settings: ReceiverSettings) => Promise<void>;
}

export function useReceiver(ownerId: string, session: number): ReceiverModel {
  const [info, setInfo] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/status', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Unable to load receiver status.');
        }
        return (await response.json()) as ServerStatus;
      })
      .then((status) => {
        setInfo(status);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(String(reason));
        }
      });
    return () => controller.abort();
  }, [session]);

  const onTune = useCallback(
    async (settings: ReceiverSettings): Promise<void> => {
      setSaving(true);
      setError(null);
      try {
        const response = await fetch('/api/receiver', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner_id: ownerId, settings }),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const applied = (await response.json()) as ReceiverSettings;
        setInfo((current) =>
          current ? { ...current, settings: applied } : current,
        );
      } catch (reason) {
        setError(String(reason));
      } finally {
        setSaving(false);
      }
    },
    [ownerId],
  );

  return { info, error, saving, onTune };
}
