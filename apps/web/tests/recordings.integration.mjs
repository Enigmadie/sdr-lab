import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';

const temporaryRoot = path.resolve('target');

async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) {
      return result;
    }
    await wait(50);
  }
  throw new Error('Recording integration condition timed out.');
}

async function launch(directory, source) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(path.resolve('target/debug/sdr-server'), [], {
    env: {
      ...process.env,
      SDR_BIND: `127.0.0.1:${port}`,
      SDR_SOURCE: source,
      SDR_RECORDINGS_DIR: directory,
      SDR_RTL_EXECUTABLE: path.resolve('apps/web/tests/fixtures/rtl-sdr.mjs'),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => {
    assert.equal(child.exitCode, null, 'server stays running');
    try {
      return (await fetch(`${base}/api/status`)).ok;
    } catch {
      return false;
    }
  });
  return {
    base,
    catalog: async () => (await fetch(`${base}/api/recordings`)).json(),
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    },
  };
}

function connect(base, route, onData) {
  const socket = new globalThis.WebSocket(base.replace('http:', 'ws:') + route);
  socket.binaryType = 'arraybuffer';
  const opened = once(socket, 'open');
  const closed = once(socket, 'close');
  const texts = [];
  socket.addEventListener('message', ({ data }) => {
    if (typeof data === 'string') {
      texts.push(data);
    } else {
      onData(Buffer.from(data), socket);
    }
  });
  return { socket, opened, closed, texts };
}

async function rejectedUpgradeStatus(url) {
  return new Promise((resolve, reject) => {
    const upgrade = request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    upgrade.on('response', (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    upgrade.on('upgrade', (_response, socket) => {
      socket.destroy();
      reject(new Error('Active recording unexpectedly accepted replay.'));
    });
    upgrade.on('error', reject);
    upgrade.end();
  });
}

for (const source of ['synthetic', 'rtlsdr']) {
  test(
    `${source}: full-block recording, exact chunked replay, seek, persistent catalog and delete`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        path.join(temporaryRoot, 'sdr-recordings-test-'),
      );
      let server = await launch(directory, source);
      let capture;
      try {
        const seen = new Map();
        let acknowledge = false;
        capture = connect(
          server.base,
          '/api/iq?owner_id=recording-integration-owner',
          (bytes, socket) => {
            const sequence = bytes.readUInt32LE(4);
            seen.set(sequence, bytes);
            if (acknowledge) {
              socket.send(`ack:${sequence}`);
            }
          },
        );
        await capture.opened;
        await until(() => seen.size > 0);
        capture.socket.send(
          `record:${JSON.stringify({ name: 'Invalid duration', seconds: 61 })}`,
        );
        await until(() =>
          capture.texts.some((text) => text.startsWith('record-error:')),
        );
        assert.deepEqual((await server.catalog()).recordings, []);
        capture.socket.send(
          `record:${JSON.stringify({ name: 'FFT fixture', seconds: 1 })}`,
        );
        const active = await until(async () =>
          (await server.catalog()).recordings.some(
            (entry) => entry.status === 'recording',
          ),
        );
        assert.equal(active, true);
        const activeEntry = (await server.catalog()).recordings[0];
        for (const method of ['PUT', 'DELETE']) {
          assert.equal(
            (
              await fetch(`${server.base}/api/recordings/${activeEntry.id}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body:
                  method === 'PUT'
                    ? JSON.stringify({ name: 'Cannot rename active capture' })
                    : undefined,
              })
            ).status,
            409,
          );
        }
        assert.equal(
          await rejectedUpgradeStatus(
            `${server.base}/api/recordings/${activeEntry.id}/replay`,
          ),
          409,
        );
        await wait(300);
        acknowledge = true;
        capture.socket.send(`ack:${[...seen.keys()].at(-1)}`);
        const saved = await until(async () =>
          (await server.catalog()).recordings.find(
            (entry) => entry.status === 'ready',
          ),
        );
        assert.equal(saved.source, source);
        assert.ok(saved.duration_seconds > 0.8 && saved.duration_seconds < 1.2);
        assert.equal(
          saved.missing_blocks,
          0,
          'browser ACK shedding never removes captured blocks from recording',
        );
        assert.ok(saved.blocks > 10);
        assert.equal(saved.path, path.join(directory, `${saved.id}.iqrec`));
        assert.equal(
          saved.sample_rate,
          source === 'synthetic' ? 48000 : 2400000,
        );
        const file = await readFile(saved.path);
        assert.equal(saved.bytes, file.length);
        const blocks = [];
        for (let offset = 0; offset < file.length;) {
          const length = file.readUInt32LE(offset);
          blocks.push(file.subarray(offset + 4, offset + 4 + length));
          offset += 4 + length;
        }
        assert.equal(blocks.length, saved.blocks);
        let matched = 0;
        for (const block of blocks) {
          const original = seen.get(block.readUInt32LE(4));
          if (original) {
            assert.deepEqual(
              block,
              original,
              'recorded samples exactly match capture samples',
            );
            matched++;
          }
        }
        assert.ok(matched > 0);
        capture.socket.send(
          `record:${JSON.stringify({ name: 'Boundary fixture', seconds: 60 })}`,
        );
        const boundary = await until(async () =>
          (await server.catalog()).recordings.find(
            (entry) => entry.name === 'Boundary fixture' && entry.blocks > 0,
          ),
        );
        if (source === 'rtlsdr') {
          assert.equal(
            (
              await fetch(`${server.base}/api/receiver`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  owner_id: 'recording-integration-owner',
                  settings: {
                    center_hz: 98900000,
                    sample_rate: 240000,
                    gain_db: null,
                  },
                }),
              })
            ).status,
            200,
          );
        }
        capture.socket.close();
        await capture.closed;
        const finalized = await until(async () =>
          (await server.catalog()).recordings.find(
            (entry) => entry.id === boundary.id && entry.status === 'ready',
          ),
        );
        assert.ok(finalized.duration_seconds > 0);
        assert.equal(
          finalized.sample_rate,
          saved.sample_rate,
          'boundary recording never mixes receiver settings',
        );
        assert.equal(
          (
            await fetch(`${server.base}/api/recordings/${boundary.id}`, {
              method: 'DELETE',
            })
          ).status,
          204,
        );
        if (source === 'rtlsdr') {
          await until(
            async () =>
              !(await (await fetch(`${server.base}/api/status`)).json())
                .device_busy,
          );
        }
        await server.close();
        server = await launch(directory, source);
        assert.equal(
          (await server.catalog()).recordings[0].id,
          saved.id,
          'catalog survives server restart',
        );
        for (const start of [0, 0.5, 0]) {
          const replayed = [];
          const replay = connect(
            server.base,
            `/api/recordings/${saved.id}/replay?start=${start}`,
            (bytes, socket) => {
              replayed.push(bytes);
              socket.send(`ack:${bytes.readUInt32LE(4)}`);
            },
          );
          await replay.closed;
          let position = 0;
          const expected = blocks.filter((block) => {
            position += block.readUInt32LE(12) / block.readUInt32LE(8);
            return position > start;
          });
          assert.deepEqual(
            replayed,
            expected,
            'replay sends every original block unchanged',
          );
          assert.ok(replay.texts.includes('replay-ended'));
          assert.ok(replay.texts.some((text) => text.startsWith('position:')));
        }
        assert.equal(
          (
            await fetch(`${server.base}/api/recordings/${saved.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: 'Renamed FM fixture' }),
            })
          ).status,
          200,
        );
        assert.equal(
          (await server.catalog()).recordings[0].name,
          'Renamed FM fixture',
        );

        // Simulate a process interruption with a partially written length prefix.
        await server.close();
        const metadataPath = path.join(directory, `${saved.id}.json`);
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        metadata.status = 'recording';
        metadata.blocks = 0;
        metadata.duration_seconds = 0;
        await writeFile(metadataPath, JSON.stringify(metadata));
        await writeFile(
          saved.path,
          Buffer.concat([file, Buffer.from([20, 0])]),
        );
        server = await launch(directory, source);
        const recovered = (await server.catalog()).recordings[0];
        assert.equal(recovered.status, 'interrupted');
        assert.equal(recovered.blocks, saved.blocks);
        assert.equal(recovered.duration_seconds, saved.duration_seconds);
        assert.equal(recovered.bytes, saved.bytes + 2);
        assert.equal(
          (
            await fetch(`${server.base}/api/recordings/${saved.id}`, {
              method: 'DELETE',
            })
          ).status,
          204,
        );
        assert.deepEqual((await server.catalog()).recordings, []);
        await assert.rejects(readFile(saved.path), { code: 'ENOENT' });
        await assert.rejects(readFile(metadataPath), { code: 'ENOENT' });
      } finally {
        capture?.socket.close();
        await server.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
