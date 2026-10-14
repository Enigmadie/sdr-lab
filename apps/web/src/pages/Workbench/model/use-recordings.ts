import { useCallback, useEffect, useState } from 'react';
import {
  deleteRecording,
  fetchRecordingCatalog,
  renameRecording,
} from '../lib/recordings-api';
import type { RecordingCatalog } from './recording-types';

const CATALOG_REFRESH_INTERVAL_MS = 1500;

export interface RecordingsModel {
  catalog: RecordingCatalog | null;
  error: string | null;
  busy: boolean;
  onRefresh: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function useRecordings(): RecordingsModel {
  const [catalog, setCatalog] = useState<RecordingCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout>;

    async function refreshCatalog(): Promise<void> {
      try {
        const nextCatalog = await fetchRecordingCatalog(controller.signal);

        if (!controller.signal.aborted) {
          setCatalog(nextCatalog);
          setLoadError(null);
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setLoadError(String(reason));
        }
      } finally {
        if (!controller.signal.aborted) {
          refreshTimer = setTimeout(
            scheduleRefresh,
            CATALOG_REFRESH_INTERVAL_MS,
          );
        }
      }
    }

    function scheduleRefresh(): void {
      void refreshCatalog();
    }

    scheduleRefresh();

    return () => {
      controller.abort();
      clearTimeout(refreshTimer);
    };
  }, [revision]);

  const handleRefresh = useCallback((): void => {
    setMutationError(null);
    setRevision((currentRevision) => currentRevision + 1);
  }, []);

  async function runMutation(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMutationError(null);

    try {
      await operation();
      handleRefresh();
    } catch (reason) {
      setMutationError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string, name: string): Promise<void> {
    await runMutation(() => renameRecording(id, name));
  }

  async function handleDelete(id: string): Promise<void> {
    await runMutation(() => deleteRecording(id));
  }

  return {
    catalog,
    error: mutationError ?? loadError,
    busy,
    onRefresh: handleRefresh,
    onRename: handleRename,
    onDelete: handleDelete,
  };
}
