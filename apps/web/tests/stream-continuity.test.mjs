import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectContinuity } from '../src/shared/lib/stream-continuity.ts';

const block = { sequence: 10, sampleRate: 48_000, count: 2048 };

test('first block and sequence wrap are continuous', () => {
  assert.deepEqual(inspectContinuity(undefined, block), {
    missing: 0,
    reset: false,
    rejected: false,
  });
  assert.deepEqual(
    inspectContinuity(
      { ...block, sequence: 0xffffffff },
      { ...block, sequence: 0 },
    ),
    {
      missing: 0,
      reset: false,
      rejected: false,
    },
  );
});

test('gaps and format changes reset DSP continuity', () => {
  assert.deepEqual(inspectContinuity(block, { ...block, sequence: 14 }), {
    missing: 3,
    reset: true,
    rejected: false,
  });
  assert.equal(
    inspectContinuity(block, { ...block, sequence: 11, sampleRate: 96_000 })
      .reset,
    true,
  );
  assert.equal(
    inspectContinuity(block, { ...block, sequence: 11, count: 4096 }).reset,
    true,
  );
});

test('duplicate and backwards sequences do not inflate loss by billions', () => {
  for (const sequence of [10, 9]) {
    assert.deepEqual(inspectContinuity(block, { ...block, sequence }), {
      missing: 0,
      reset: true,
      rejected: true,
    });
  }
});

test('retuning the same sample rate still resets DSP', () => {
  assert.equal(
    inspectContinuity(
      { ...block, centerHz: 97100000 },
      { ...block, sequence: 11, centerHz: 98900000 },
    ).reset,
    true,
  );
});
