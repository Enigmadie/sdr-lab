import shaderCode from './waterfall.wgsl?raw';

export const WATERFALL_HISTORY_ROWS = 512;
const UNIFORM_BYTES = 32;

export interface WaterfallRange {
  floorDbfs: number;
  ceilingDbfs: number;
}

export class WebGpuUnavailableError extends Error {}

export class WaterfallRenderer {
  private history: GPUTexture | undefined;
  private bindGroup: GPUBindGroup | undefined;
  private binCount = 0;
  private nextRow = 0;
  private validRows = 0;
  private readonly uniformData = new ArrayBuffer(UNIFORM_BYTES);

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly pipeline: GPURenderPipeline,
    private readonly uniforms: GPUBuffer,
    private readonly layout: GPUBindGroupLayout,
  ) {}

  append(bins: Float32Array): void {
    if (!(bins.buffer instanceof ArrayBuffer)) {
      throw new Error('Waterfall input must use a transferable ArrayBuffer.');
    }

    this.ensureHistory(bins.length);

    if (!this.history) {
      return;
    }

    // writeTexture does not require the 256-byte row alignment of buffer copies.
    this.device.queue.writeTexture(
      { texture: this.history, origin: { x: 0, y: this.nextRow } },
      bins.buffer,
      {
        offset: bins.byteOffset,
        bytesPerRow: this.binCount * Float32Array.BYTES_PER_ELEMENT,
      },
      { width: this.binCount, height: 1 },
    );
    this.nextRow = (this.nextRow + 1) % WATERFALL_HISTORY_ROWS;
    this.validRows = Math.min(this.validRows + 1, WATERFALL_HISTORY_ROWS);
  }

  clear(): void {
    // The shader ignores rows outside validRows, so no full texture upload
    // is needed to clear or restart a stream.
    this.nextRow = 0;
    this.validRows = 0;
  }

  resize(): boolean {
    const limit = this.device.limits.maxTextureDimension2D;
    const width = Math.max(
      1,
      Math.min(limit, Math.round(this.canvas.clientWidth * devicePixelRatio)),
    );
    const height = Math.max(
      1,
      Math.min(limit, Math.round(this.canvas.clientHeight * devicePixelRatio)),
    );

    if (this.canvas.width === width && this.canvas.height === height) {
      return false;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  render(range: WaterfallRange): void {
    // Allocate an empty history for the first frame before the stream arrives.
    this.ensureHistory(this.binCount || 1);

    if (!this.bindGroup) {
      return;
    }

    const view = new DataView(this.uniformData);
    view.setFloat32(0, this.canvas.width, true);
    view.setFloat32(4, this.canvas.height, true);
    view.setUint32(8, this.binCount, true);
    view.setUint32(12, WATERFALL_HISTORY_ROWS, true);
    view.setUint32(16, this.nextRow, true);
    view.setUint32(20, this.validRows, true);
    view.setFloat32(24, range.floorDbfs, true);
    view.setFloat32(28, range.ceilingDbfs, true);
    this.device.queue.writeBuffer(this.uniforms, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.051, g: 0.082, b: 0.125, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.context.unconfigure();
    this.history?.destroy();
    this.uniforms.destroy();
    this.device.destroy();
  }

  private ensureHistory(binCount: number): void {
    if (this.history && this.binCount === binCount) {
      return;
    }

    if (binCount > this.device.limits.maxTextureDimension2D) {
      throw new Error('The FFT size exceeds this GPU’s texture limit.');
    }

    this.history?.destroy();
    this.binCount = binCount;
    this.clear();
    this.history = this.device.createTexture({
      label: 'Waterfall spectrum ring',
      size: { width: binCount, height: WATERFALL_HISTORY_ROWS },
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: this.history.createView() },
        { binding: 1, resource: { buffer: this.uniforms } },
      ],
    });
  }
}

export async function createWaterfallRenderer(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  onDeviceLost: (detail: string) => void,
  onGpuError: (detail: string) => void,
): Promise<WaterfallRenderer> {
  if (!window.isSecureContext) {
    throw new WebGpuUnavailableError(
      'WebGPU requires localhost or a trusted HTTPS connection.',
    );
  }

  if (!navigator.gpu) {
    throw new WebGpuUnavailableError('This browser does not support WebGPU.');
  }

  const adapter = await navigator.gpu.requestAdapter();
  signal.throwIfAborted();

  if (!adapter) {
    throw new WebGpuUnavailableError('No WebGPU adapter is available.');
  }

  const device = await adapter.requestDevice();

  try {
    signal.throwIfAborted();

    const context = canvas.getContext('webgpu');

    if (!context) {
      throw new WebGpuUnavailableError('Unable to create a WebGPU canvas.');
    }

    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    const shader = device.createShaderModule({
      label: 'Waterfall color mapping',
      code: shaderCode,
    });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: shader, entryPoint: 'vertex_main' },
      fragment: {
        module: shader,
        entryPoint: 'fragment_main',
        targets: [{ format }],
      },
    });
    signal.throwIfAborted();

    const uniforms = device.createBuffer({
      label: 'Waterfall view settings',
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Configure only after all async work, so a cancelled StrictMode mount
    // cannot reconfigure a canvas belonging to a newer renderer.
    context.configure({ device, format, alphaMode: 'opaque' });

    void device.lost.then((info) => {
      if (!signal.aborted) {
        onDeviceLost(info.message || 'The GPU device was lost.');
      }
    });
    device.onuncapturederror = (event) => {
      if (!signal.aborted) {
        onGpuError(event.error.message);
      }
    };

    return new WaterfallRenderer(
      device,
      context,
      canvas,
      pipeline,
      uniforms,
      layout,
    );
  } catch (error) {
    device.destroy();
    throw error;
  }
}
