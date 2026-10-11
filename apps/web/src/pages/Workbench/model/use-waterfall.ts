import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  createWaterfallRenderer,
  WebGpuUnavailableError,
} from '../../../gpu/waterfall-renderer';
import type {
  WaterfallRange,
  WaterfallRenderer,
} from '../../../gpu/waterfall-renderer';
import type { SpectrumFrame } from '../../../workers/messages';

type GpuState = 'initializing' | 'ready' | 'unavailable' | 'lost' | 'error';

export interface WaterfallStatus {
  state: GpuState;
  detail?: string;
}

interface WaterfallModel {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: WaterfallStatus;
  paused: boolean;
  range: WaterfallRange;
  onTogglePause: () => void;
  onFloorChange: (value: number) => void;
  onCeilingChange: (value: number) => void;
  onRetry: () => void;
}

const INITIAL_RANGE: WaterfallRange = { floorDbfs: -90, ceilingDbfs: -10 };
const MIN_RANGE_DB = 5;

export function useWaterfall(
  latestFrame: RefObject<SpectrumFrame | null>,
  streamSession: number,
): WaterfallModel {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<WaterfallStatus>({
    state: 'initializing',
  });
  const [paused, setPaused] = useState(false);
  const [range, setRange] = useState(INITIAL_RANGE);
  const [attempt, setAttempt] = useState(0);
  const settings = useRef({ paused, range, streamSession });

  useEffect(() => {
    settings.current = { paused, range, streamSession };
  }, [paused, range, streamSession]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const controller = new AbortController();
    let renderer: WaterfallRenderer | undefined;
    let animationId = 0;
    let lastFrame: SpectrumFrame | null = null;
    let lastRange: WaterfallRange | null = null;
    let lastSession = settings.current.streamSession;
    let lastBand: string | null = null;

    function fail(state: 'lost' | 'error', detail: string): void {
      controller.abort();
      cancelAnimationFrame(animationId);
      renderer?.destroy();
      renderer = undefined;
      setStatus({ state, detail });
    }

    function drawFrame(): void {
      if (!renderer || controller.signal.aborted) {
        return;
      }

      try {
        const currentSettings = settings.current;
        let needsRender = renderer.resize();

        if (lastSession !== currentSettings.streamSession) {
          renderer.clear();
          lastFrame = null;
          lastSession = currentSettings.streamSession;
          needsRender = true;
        }

        const frame = latestFrame.current;
        if (frame) {
          const band = `${frame.centerHz}:${frame.sampleRate}`;
          if (lastBand !== null && band !== lastBand) {
            renderer.clear();
            lastFrame = null;
            needsRender = true;
          }
          lastBand = band;
        }

        if (!currentSettings.paused && frame && frame !== lastFrame) {
          renderer.append(frame.bins);
          lastFrame = frame;
          needsRender = true;
        }

        if (lastRange !== currentSettings.range) {
          lastRange = currentSettings.range;
          needsRender = true;
        }

        if (needsRender) {
          renderer.render(currentSettings.range);
        }

        animationId = requestAnimationFrame(drawFrame);
      } catch (error) {
        fail('error', String(error));
      }
    }

    async function initialize(target: HTMLCanvasElement): Promise<void> {
      try {
        renderer = await createWaterfallRenderer(
          target,
          controller.signal,
          (detail) => fail('lost', detail),
          (detail) => fail('error', detail),
        );

        if (controller.signal.aborted) {
          renderer.destroy();
          return;
        }

        setStatus({ state: 'ready' });
        drawFrame();
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus({
            state:
              error instanceof WebGpuUnavailableError ? 'unavailable' : 'error',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void initialize(canvas);

    return () => {
      controller.abort();
      cancelAnimationFrame(animationId);
      renderer?.destroy();
    };
  }, [latestFrame, attempt]);

  function handleFloorChange(value: number): void {
    setRange((current) => ({
      ...current,
      floorDbfs: Math.max(
        -120,
        Math.min(value, current.ceilingDbfs - MIN_RANGE_DB),
      ),
    }));
  }

  function handleCeilingChange(value: number): void {
    setRange((current) => ({
      ...current,
      ceilingDbfs: Math.min(
        0,
        Math.max(value, current.floorDbfs + MIN_RANGE_DB),
      ),
    }));
  }

  function handleRetry(): void {
    setStatus({ state: 'initializing' });
    setAttempt((current) => current + 1);
  }

  return {
    canvasRef,
    status,
    paused,
    range,
    onTogglePause: () => setPaused((current) => !current),
    onFloorChange: handleFloorChange,
    onCeilingChange: handleCeilingChange,
    onRetry: handleRetry,
  };
}
