import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseAllDocuments, stringify } from 'yaml';

const imagePattern = /^ghcr\.io\/enigmadie\/sdr-lab@sha256:[a-f0-9]{64}$/;
const recordingsPath = '/opt/sdr-lab/recordings';

export function promoteImage(source, image) {
  if (!imagePattern.test(image)) {
    throw new Error('Expected an immutable ghcr.io/enigmadie/sdr-lab digest.');
  }
  const documents = parseAllDocuments(source);
  for (const document of documents) {
    if (document.errors.length > 0) {
      throw new Error(document.errors.map((error) => error.message).join('\n'));
    }
  }
  const deployments = documents.filter(
    (document) =>
      document.get('kind') === 'Deployment' &&
      document.getIn(['metadata', 'name']) === 'sdr-lab',
  );
  if (deployments.length !== 1) {
    throw new Error('Expected exactly one sdr-lab Deployment.');
  }
  const document = deployments[0];
  const deployment = document.toJS();
  const pod = deployment.spec.template.spec;
  const servers = pod.containers.filter(
    (container) => container.name === 'server',
  );
  if (servers.length !== 1 || deployment.spec.strategy?.type !== 'Recreate') {
    throw new Error('Expected one server container and Recreate strategy.');
  }
  if (pod.nodeSelector?.['homelab/role'] !== 'apps') {
    throw new Error('Recordings hostPath requires the OptiPlex apps node.');
  }
  const server = servers[0];
  if (
    server.image !== 'debian:trixie-slim' &&
    !imagePattern.test(server.image)
  ) {
    throw new Error('Unexpected source image; review the deployment manually.');
  }
  server.image = image;
  delete server.command;
  delete server.args;
  // Live USB access currently needs root + privileged, unlike synthetic mode.
  server.securityContext = {
    ...server.securityContext,
    runAsUser: 0,
    runAsGroup: 0,
  };
  const environment = new Map(
    (server.env ?? []).map((entry) => [entry.name, entry]),
  );
  environment.set('SDR_WEB_DIR', { name: 'SDR_WEB_DIR', value: '/app/web' });
  environment.set('SDR_RECORDINGS_DIR', {
    name: 'SDR_RECORDINGS_DIR',
    value: '/data/recordings',
  });
  server.env = [...environment.values()];
  server.volumeMounts = (server.volumeMounts ?? []).filter(
    (mount) => !['runtime', 'recordings'].includes(mount.name),
  );
  server.volumeMounts.push({
    name: 'recordings',
    mountPath: '/data/recordings',
  });
  pod.volumes = (pod.volumes ?? []).filter(
    (volume) => !['runtime', 'recordings'].includes(volume.name),
  );
  pod.volumes.push({
    name: 'recordings',
    hostPath: { path: recordingsPath, type: 'DirectoryOrCreate' },
  });
  document.contents = document.createNode(deployment);
  document.commentBefore =
    ' Immutable SDR Lab runtime; managed by the sdr-lab image promotion workflow.\n' +
    ' Recordings persist on OptiPlex at /opt/sdr-lab/recordings (not in the image).';
  return documents
    .map((entry) => {
      entry.directives.docStart = false;
      return stringify(entry);
    })
    .join('---\n');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [manifestPath, image] = process.argv.slice(2);
  if (!manifestPath || !image) {
    throw new Error(
      'Usage: node scripts/promote-image.mjs <lab.yaml> <image@sha256:...>',
    );
  }
  const source = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, promoteImage(source, image));
}
