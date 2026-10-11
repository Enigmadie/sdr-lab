import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';

const base = process.env.SDR_RECEIVER_URL ?? 'http://127.0.0.1:3002';
const ownerId = 'receiver-integration-owner';
const streamUrl = new URL(`/api/iq?owner_id=${ownerId}`, base);
streamUrl.protocol = 'ws:';
const settings = { center_hz: 98900000, sample_rate: 240000, gain_db: null };
const tune = (owner_id, receiverSettings = settings) =>
  fetch(`${base}/api/receiver`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_id, settings: receiverSettings }),
  });

test('exclusive ownership, validated tuning, metadata boundary, and release', async () => {
  assert.equal((await tune('not-owner')).status, 409);
  const socket = new globalThis.WebSocket(streamUrl);
  socket.binaryType = 'arraybuffer';
  const frames = [];
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    if (typeof data === 'string') {
      if (data.startsWith('error:')) {
        errors.push(data);
      }
      return;
    }
    const view = new DataView(data);
    const sequence = view.getUint32(4, true);
    frames.push({
      sequence,
      sampleRate: view.getUint32(8, true),
      centerHz: view.getUint32(16, true),
    });
    socket.send(`ack:${sequence}`);
  });
  try {
    await wait(600);
    assert.ok(frames.length > 0, JSON.stringify(errors));
    assert.equal(
      (await (await fetch(`${base}/api/status`)).json()).device_busy,
      true,
    );
    const second = new globalThis.WebSocket(streamUrl);
    const busy = await new Promise((resolve, reject) => {
      second.addEventListener('message', ({ data }) => resolve(data));
      second.addEventListener('error', reject);
    });
    second.close();
    assert.match(busy, /already owned/);
    assert.equal(
      (await tune(ownerId, { ...settings, gain_db: 12 })).status,
      400,
    );
    assert.equal((await tune('wrong-owner')).status, 409);
    const lastSequence = frames.at(-1).sequence;
    assert.equal((await tune(ownerId)).status, 200);
    await wait(600);
    const retuned = frames.find(
      (frame) =>
        frame.centerHz === settings.center_hz &&
        frame.sampleRate === settings.sample_rate,
    );
    assert.ok(retuned, 'retuned metadata reaches the stream');
    assert.ok(
      retuned.sequence > lastSequence,
      'retuning never restarts sequence at zero',
    );
    assert.deepEqual(errors, []);
  } finally {
    socket.close();
  }
  await wait(200);
  assert.equal(
    (await (await fetch(`${base}/api/status`)).json()).device_busy,
    false,
  );
  assert.equal(
    (await tune(ownerId)).status,
    409,
    'disconnected owner cannot tune',
  );
});
