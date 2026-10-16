import assert from 'node:assert/strict';
import { once } from 'node:events';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';

const base = process.env.SDR_SMOKE_URL ?? 'http://127.0.0.1:3000';

async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) {
      return;
    }
    await wait(100);
  }
  throw new Error('Production smoke condition timed out.');
}

test(
  'production UI, WASM asset, synthetic stream, disk recording and replay',
  { timeout: 20000 },
  async () => {
    await until(async () => {
      try {
        return (await fetch(`${base}/api/status`)).ok;
      } catch {
        return false;
      }
    });
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.source, 'synthetic', 'smoke must never use real USB');
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    const scriptPath = html.match(/src="([^"]+\.js)"/)[1];
    const javascript = await (await fetch(new URL(scriptPath, base))).text();
    assert.ok(javascript.length > 100);
    // Vite emits the WASM URL in the worker bundle, referenced by the entry chunk.
    const workerPath = javascript.match(/\/assets\/dsp\.worker-[^"`]+\.js/)[0];
    const worker = await (await fetch(new URL(workerPath, base))).text();
    const wasmPath = worker.match(/\/assets\/sdr_dsp_wasm_bg-[^"`]+\.wasm/)[0];
    const wasmResponse = await fetch(new URL(wasmPath, base));
    assert.equal(wasmResponse.headers.get('content-type'), 'application/wasm');
    const wasm = new Uint8Array(await wasmResponse.arrayBuffer());
    assert.deepEqual([...wasm.slice(0, 4)], [0, 97, 115, 109]);

    const catalog = async () =>
      (await (await fetch(`${base}/api/recordings`)).json()).recordings;
    const name = `Production smoke ${Date.now()}`;
    const socket = new WebSocket(
      `${base.replace('http:', 'ws:')}/api/iq?owner_id=production-smoke`,
    );
    socket.binaryType = 'arraybuffer';
    const errors = [];
    let blocks = 0;
    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') {
        if (data.includes('error:')) {
          errors.push(data);
        }
        return;
      }
      const view = new DataView(data);
      blocks++;
      socket.send(`ack:${view.getUint32(4, true)}`);
    });
    let entry;
    try {
      await once(socket, 'open');
      await until(() => blocks > 0);
      socket.send(`record:${JSON.stringify({ name, seconds: 1 })}`);
      await until(async () => {
        entry = (await catalog()).find((recording) => recording.name === name);
        return entry && entry.status !== 'recording';
      });
      assert.equal(entry.status, 'ready');
      assert.ok(entry.bytes > 0);
      const replay = new WebSocket(
        `${base.replace('http:', 'ws:')}/api/recordings/${entry.id}/replay`,
      );
      replay.binaryType = 'arraybuffer';
      const closed = once(replay, 'close');
      let replayBlocks = 0;
      replay.addEventListener('message', ({ data }) => {
        if (typeof data !== 'string') {
          replayBlocks++;
          replay.send(`ack:${new DataView(data).getUint32(4, true)}`);
        }
      });
      try {
        await until(() => replayBlocks > 0);
      } finally {
        replay.close();
        await closed;
      }
      assert.deepEqual(errors, []);
    } finally {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
      if (entry) {
        assert.equal(
          (
            await fetch(`${base}/api/recordings/${entry.id}`, {
              method: 'DELETE',
            })
          ).status,
          204,
        );
      }
    }
  },
);
