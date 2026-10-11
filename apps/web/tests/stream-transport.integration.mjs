import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';

const url = process.env.SDR_TEST_URL ?? 'ws://127.0.0.1:3000/api/iq';

test('one in-flight block, matching ACK, source gaps, ping, and stall timeout', async () => {
  const socket = new globalThis.WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const sequences = [];
  const texts = [];
  const closed = new Promise((resolve) =>
    socket.addEventListener('close', resolve),
  );
  socket.addEventListener('message', ({ data }) => {
    if (typeof data === 'string') {
      texts.push(data);
    } else {
      sequences.push(new DataView(data).getUint32(4, true));
    }
  });
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve);
      socket.addEventListener('error', reject);
    });
    await wait(300);
    assert.equal(sequences.length, 1, 'no backlog without ACK');
    socket.send(`ack:${sequences[0] + 1}`);
    socket.send('ping:transport-check');
    await wait(150);
    assert.equal(sequences.length, 1, 'wrong ACK does not release credit');
    assert.deepEqual(texts, ['ping:transport-check']);
    socket.send(`ack:${sequences[0]}`);
    await wait(150);
    assert.equal(sequences.length, 2);
    assert.ok(
      sequences[1] - sequences[0] >= 8,
      'skipped capture blocks remain visible',
    );
    socket.send('ping:second-check');
    await wait(100);
    assert.deepEqual(texts, ['ping:transport-check', 'ping:second-check']);
    await Promise.race([
      closed,
      wait(3000).then(() => {
        throw new Error('Unacknowledged stream did not close');
      }),
    ]);
    assert.equal(
      sequences.length,
      2,
      'stalled connection never accumulates blocks',
    );
  } finally {
    socket.close();
  }
});
