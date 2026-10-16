import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAllDocuments, stringify } from 'yaml';

import { promoteImage } from './promote-image.mjs';

const image = `ghcr.io/enigmadie/sdr-lab@sha256:${'a'.repeat(64)}`;

function fixture(replicas) {
  return [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'sdr-lab', namespace: 'radio' },
      spec: {
        replicas,
        strategy: { type: 'Recreate' },
        template: {
          spec: {
            nodeSelector: { 'homelab/role': 'apps' },
            containers: [
              {
                name: 'server',
                image: 'debian:trixie-slim',
                command: [
                  '/bin/sh',
                  '-ec',
                  'apt-get update; exec /runtime/sdr-server',
                ],
                env: [{ name: 'SDR_SOURCE', value: 'rtlsdr' }],
                securityContext: { privileged: true },
                volumeMounts: [
                  { name: 'usb', mountPath: '/dev/bus/usb' },
                  { name: 'runtime', mountPath: '/runtime', readOnly: true },
                ],
              },
            ],
            volumes: [
              { name: 'usb', hostPath: { path: '/dev/bus/usb' } },
              { name: 'runtime', hostPath: { path: '/opt/sdr-lab/runtime' } },
            ],
          },
        },
      },
    },
    {
      kind: 'Service',
      metadata: { name: 'sdr-lab' },
      spec: { ports: [{ port: 80 }] },
    },
    {
      kind: 'IngressRoute',
      metadata: { name: 'sdr-lab' },
      spec: { entryPoints: ['web'] },
    },
  ];
}

const encode = (documents) =>
  documents.map((document) => stringify(document)).join('---\n');

for (const replicas of [0, 1]) {
  test(`promotion preserves mode (${replicas} replicas) and unrelated resources`, () => {
    const source = fixture(replicas);
    const promoted = promoteImage(encode(source), image);
    const result = parseAllDocuments(promoted).map((document) =>
      document.toJS(),
    );
    assert.deepEqual(result.slice(1), source.slice(1));
    assert.equal(result[0].spec.replicas, replicas);
    assert.equal(result[0].metadata.namespace, 'radio');
    const pod = result[0].spec.template.spec;
    const server = pod.containers[0];
    assert.equal(server.image, image);
    assert.equal(server.command, undefined);
    assert.equal(server.securityContext.privileged, true);
    assert.equal(server.securityContext.runAsUser, 0);
    assert.ok(
      server.env.some(
        (entry) => entry.name === 'SDR_SOURCE' && entry.value === 'rtlsdr',
      ),
    );
    assert.ok(
      server.env.some(
        (entry) =>
          entry.name === 'SDR_RECORDINGS_DIR' &&
          entry.value === '/data/recordings',
      ),
    );
    assert.deepEqual(
      pod.volumes.map((volume) => volume.name),
      ['usb', 'recordings'],
    );
    assert.equal(pod.volumes[1].hostPath.path, '/opt/sdr-lab/recordings');
    assert.equal(
      promoteImage(promoted, image),
      promoted,
      'promotion is idempotent',
    );
    const nextImage = image.replace(/a{64}$/, 'b'.repeat(64));
    const next = parseAllDocuments(promoteImage(promoted, nextImage)).map(
      (document) => document.toJS(),
    );
    assert.equal(next[0].spec.template.spec.containers[0].image, nextImage);
    next[0].spec.template.spec.containers[0].image = image;
    assert.deepEqual(
      next,
      result,
      'subsequent promotion changes only the digest',
    );
  });
}

test('promotion rejects mutable or foreign images and unexpected manifests', () => {
  assert.throws(() =>
    promoteImage(encode(fixture(1)), 'ghcr.io/enigmadie/sdr-lab:latest'),
  );
  assert.throws(() => promoteImage('kind: Service', image));
  assert.throws(() => promoteImage('a: [', image));
  const duplicated = fixture(1);
  duplicated.push(duplicated[0]);
  assert.throws(() => promoteImage(encode(duplicated), image));
  const changed = fixture(1);
  changed[0].spec.strategy.type = 'RollingUpdate';
  assert.throws(() => promoteImage(encode(changed), image));
  changed[0].spec.strategy.type = 'Recreate';
  changed[0].spec.template.spec.nodeSelector['homelab/role'] = 'edge';
  assert.throws(() => promoteImage(encode(changed), image));
});
