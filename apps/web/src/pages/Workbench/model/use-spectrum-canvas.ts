import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SpectrumFrame } from '../../../workers/messages';
import { drawSpectrum, resizeCanvas } from '../lib/draw-spectrum';

export function useSpectrumCanvas(
  latestFrame: RefObject<SpectrumFrame | null>,
): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return;
    }

    let animationId = 0;
    let lastDrawnFrame: SpectrumFrame | null = null;

    const drawFrame = (): void => {
      const wasResized = resizeCanvas(canvas);
      const frame = latestFrame.current;

      if (wasResized) {
        lastDrawnFrame = null;
      }

      if (frame && frame !== lastDrawnFrame) {
        drawSpectrum(context, frame.bins);
        lastDrawnFrame = frame;
      }

      animationId = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    return () => cancelAnimationFrame(animationId);
  }, [latestFrame]);

  return canvasRef;
}
