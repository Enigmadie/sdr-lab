import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeIqBlock } from '../src/shared/lib/decode-iq-block.ts';

function rtlBlock(count = 32768) {
  const buffer = new ArrayBuffer(24 + count * 2);
  const view = new DataView(buffer);
  view.setUint32(0, 0x49513032, false);
  view.setUint32(4, 17, true);
  view.setUint32(8, 2400000, true);
  view.setUint32(12, count, true);
  view.setUint32(16, 97100000, true);
  view.setUint32(20, 1, true);
  new Uint8Array(buffer, 24).fill(128);
  view.setUint8(buffer.byteLength - 2, 0);
  view.setUint8(buffer.byteLength - 1, 255);
  return buffer;
}

test('RTL block retains capture count but decodes only the latest FFT window', () => {
  const block = decodeIqBlock(rtlBlock());
  assert.equal(block.count, 32768);
  assert.equal(block.samples.length, 4096);
  assert.equal(block.centerHz, 97100000);
  assert.equal(block.sequence, 17);
  assert.equal(block.samples.at(-2), -1);
  assert.equal(block.samples.at(-1), 1);
  assert.ok(Math.abs(block.samples[0] - 1 / 255) < 1e-8);
});

test('RTL metadata and truncated payloads are rejected', () => {
  const buffer = rtlBlock(16);
  new DataView(buffer).setUint32(20, 2, true);
  assert.throws(() => decodeIqBlock(buffer), /metadata/);
  assert.throws(
    () => decodeIqBlock(rtlBlock().slice(0, 40)),
    /Invalid I\/Q block/,
  );
});
