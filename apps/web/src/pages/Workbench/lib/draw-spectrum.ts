const MIN_DBFS = -100;
const MAX_DBFS = 0;
const GRID_DIVISIONS = 5;

export function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const width = Math.round(canvas.clientWidth * window.devicePixelRatio);
  const height = Math.round(canvas.clientHeight * window.devicePixelRatio);

  if (canvas.width === width && canvas.height === height) {
    return false;
  }

  canvas.width = width;
  canvas.height = height;

  return true;
}

function drawGrid(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas;
  context.strokeStyle = '#263646';
  context.lineWidth = window.devicePixelRatio;

  for (let row = 1; row < GRID_DIVISIONS; row++) {
    const y = (height * row) / GRID_DIVISIONS;

    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function getVerticalPosition(dbfs: number, height: number): number {
  const normalizedPower = (dbfs - MIN_DBFS) / (MAX_DBFS - MIN_DBFS);
  const clampedPower = Math.max(0, Math.min(1, normalizedPower));

  return height * (1 - clampedPower);
}

export function drawSpectrum(
  context: CanvasRenderingContext2D,
  bins: Float32Array,
): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  drawGrid(context);

  context.strokeStyle = '#65e4c0';
  context.beginPath();

  bins.forEach((dbfs, index) => {
    const x = (index / (bins.length - 1)) * width;
    const y = getVerticalPosition(dbfs, height);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}
