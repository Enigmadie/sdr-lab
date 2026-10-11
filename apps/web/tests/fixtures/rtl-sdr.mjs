#!/usr/bin/env node
import process from 'node:process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';

const argument = (flag) => Number(process.argv[process.argv.indexOf(flag) + 1]);
const sampleRate = argument('-s');
const bytesPerBlock = argument('-b');
let sampleIndex = 0;
while (true) {
  const block = new Uint8Array(bytesPerBlock);
  for (let index = 0; index < block.length; index += 2) {
    const phase = (2 * Math.PI * 6000 * sampleIndex++) / sampleRate;
    block[index] = Math.round(127.5 + 60 * Math.cos(phase));
    block[index + 1] = Math.round(127.5 + 60 * Math.sin(phase));
  }
  if (!process.stdout.write(block)) {
    await once(process.stdout, 'drain');
  }
  await wait((bytesPerBlock / 2 / sampleRate) * 1000);
}
