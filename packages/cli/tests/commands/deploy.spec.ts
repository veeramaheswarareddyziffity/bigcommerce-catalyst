import AdmZip from 'adm-zip';
import { Command } from 'commander';
import { http, HttpResponse } from 'msw';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  MockInstance,
  test,
  vi,
} from 'vitest';

import {
  createDeployment,
  deploy,
  generateBundleZip,
  generateUploadSignature,
  getDeploymentStatus,
  parseEnvironmentVariables,
  uploadBundleZip,
} from '../../src/commands/deploy';
import { consola } from '../../src/lib/logger';
import { mkTempDir } from '../../src/lib/mk-temp-dir';
import { program } from '../../src/program';
import { server } from '../mocks/node';
import { textHistory } from '../mocks/spinner';

// eslint-disable-next-line import/dynamic-import-chunkname
vi.mock('yocto-spinner', () => import('../mocks/spinner'));

let exitMock: MockInstance;

let tmpDir: string;
let cleanup: () => Promise<void>;
let outputZip: string;

const projectUuid = 'a23f5785-fd99-4a94-9fb3-945551623923';
const storeHash = 'test-store';
const accessToken = 'test-token';
const apiHost = 'api.bigcommerce.com';
const uploadUuid = '0e93ce5f-6f91-4236-87ec-ca79627f31ba';
const uploadUrl = 'https://mock-upload-url.com';
const deploymentUuid = '5b29c3c0-5f68-44fe-99e5-06492babf7be';

beforeAll(async () => {
  consola.mockTypes(() => vi.fn());
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  exitMock = vi.spyOn(process, 'exit').mockImplementation(() => null as never);

  [tmpDir, cleanup] = await mkTempDir();

  // Normalize to /private/var to avoid /var vs /private/var mismatches
  tmpDir = await realpath(tmpDir);

  const workerPath = join(tmpDir, '.bigcommerce', 'dist', 'worker.js');
  const assetsDir = join(tmpDir, '.bigcommerce', 'dist', 'assets');

  outputZip = join(tmpDir, '.bigcommerce', 'bundle.zip');

  await mkdir(dirname(workerPath), { recursive: true });
  await writeFile(workerPath, 'console.log("worker");');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, 'test.txt'), 'asset file');
});

beforeEach(() => {
  process.chdir(tmpDir);
});

afterEach(() => {
  vi.clearAllMocks();

  // Resets spinner text history
  textHistory.length = 0;
});

afterAll(async () => {
  await cleanup();
});

test('properly configured Command instance', () => {
  expect(deploy).toBeInstanceOf(Command);
  expect(deploy.name()).toBe('deploy');
  expect(deploy.description()).toBe('Deploy your application to Cloudflare.');
  expect(deploy.options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ flags: '--store-hash <hash>' }),
      expect.objectContaining({ flags: '--access-token <token>' }),
      expect.objectContaining({ flags: '--api-host <host>', defaultValue: 'api.bigcommerce.com' }),
      expect.objectContaining({ flags: '--project-uuid <uuid>' }),
      expect.objectContaining({ flags: '--secret <secrets...>' }),
      expect.objectContaining({ flags: '--dry-run' }),
    ]),
  );
});

describe('bundle zip generation and upload', () => {
  test('creates bundle.zip from build output', async () => {
    await generateBundleZip();

    // Check file exists
    const stats = await stat(outputZip);

    expect(stats.size).toBeGreaterThan(0);

    expect(consola.info).toHaveBeenCalledWith('Generating bundle...');
    expect(consola.success).toHaveBeenCalledWith(`Bundle created at: ${outputZip}`);
  });

  test('zip contains output folder with assets and worker.js', async () => {
    await generateBundleZip();

    // Check file exists
    const stats = await stat(outputZip);

    expect(stats.size).toBeGreaterThan(0);

    const zip = new AdmZip(outputZip);
    const entries = zip.getEntries().map((e) => e.entryName);

    // Check for output/ folder
    expect(entries.every((e) => e.startsWith('output/'))).toBe(true);
    // Check for output/assets/ directory
    expect(entries.some((e) => e.startsWith('output/assets/'))).toBe(true);
    // Check for output/worker.js
    expect(entries).toContain('output/worker.js');

    expect(consola.success).toHaveBeenCalledWith(`Bundle created at: ${outputZip}`);
  });

  test('fetches upload signature', async () => {
    const signature = await generateUploadSignature(storeHash, accessToken, apiHost);

    expect(consola.info).toHaveBeenCalledWith('Generating upload signature...');
    expect(consola.success).toHaveBeenCalledWith('Upload signature generated.');

    expect(signature.upload_url).toBe(uploadUrl);
    expect(signature.upload_uuid).toBe(uploadUuid);
  });

  test('fetches upload signature and uploads bundle zip', async () => {
    const uploadResult = await uploadBundleZip(uploadUrl);

    expect(consola.info).toHaveBeenCalledWith('Uploading bundle...');
    expect(consola.success).toHaveBeenCalledWith('Bundle uploaded successfully.');

    expect(uploadResult).toBe(true);
  });
});

describe('deployment and event streaming', () => {
  test('creates a deployment', async () => {
    const deployment = await createDeployment(
      projectUuid,
      uploadUuid,
      storeHash,
      accessToken,
      apiHost,
    );

    expect(deployment.deployment_uuid).toBe(deploymentUuid);
  });

  test('streams deployment status until completion', async () => {
    await getDeploymentStatus(deploymentUuid, storeHash, accessToken, apiHost);

    expect(consola.info).toHaveBeenCalledWith('Fetching deployment status...');

    expect(textHistory).toEqual([
      'Fetching...',
      'Processing...',
      'Finalizing...',
      'Deployment completed successfully.',
    ]);
  });

  test('warns if event stream is incomplete or unable to be parsed', async () => {
    const encoder = new TextEncoder();

    server.use(
      http.get(
        'https://:apiHost/stores/:storeHash/v3/infrastructure/deployments/:deploymentUuid/events',
        () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: {"deployment_status":"in_progress","deployment_uuid":"${deploymentUuid}","event":{"step":"processing","progress":75}}`,
                ),
              );
              setTimeout(() => {
                // Incomplete stream data
                controller.enqueue(encoder.encode(`data: {"deployment_status":"in_progress",`));
              }, 10);
              setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `data: {"deployment_status":"in_progress","deployment_uuid":"${deploymentUuid}","event":{"step":"finalizing","progress":99}}`,
                  ),
                );
                controller.close();
              }, 20);
            },
          });

          return new HttpResponse(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        },
      ),
    );

    await getDeploymentStatus(deploymentUuid, storeHash, accessToken, apiHost);

    expect(consola.info).toHaveBeenCalledWith('Fetching deployment status...');

    expect(textHistory).toEqual([
      'Fetching...',
      'Processing...',
      'Finalizing...',
      'Deployment completed successfully.',
    ]);

    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse event, dropping from stream.'),
      expect.any(Error),
    );
  });

  test('handles deployment errors', async () => {
    const encoder = new TextEncoder();

    server.use(
      http.get(
        'https://:apiHost/stores/:storeHash/v3/infrastructure/deployments/:deploymentUuid/events',
        () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: {"deployment_status":"in_progress","deployment_uuid":"${deploymentUuid}","event":{"step":"processing","progress":75}}`,
                ),
              );
              setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `data: {"deployment_status":"in_progress","deployment_uuid":"${deploymentUuid}","event":{"step":"unzipping","progress":99},"error":{"code":30}}`,
                  ),
                );
              }, 10);
            },
          });

          return new HttpResponse(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        },
      ),
    );

    await expect(
      getDeploymentStatus(deploymentUuid, storeHash, accessToken, apiHost),
    ).rejects.toThrow('Deployment failed with error code: 30');

    expect(consola.info).toHaveBeenCalledWith('Fetching deployment status...');

    expect(textHistory).toEqual(['Fetching...', 'Processing...']);
  });
});

test('--dry-run skips upload and deployment', async () => {
  await program.parseAsync([
    'node',
    'catalyst',
    'deploy',
    '--store-hash',
    storeHash,
    '--access-token',
    accessToken,
    '--api-host',
    apiHost,
    '--project-uuid',
    projectUuid,
    '--dry-run',
  ]);

  expect(consola.info).toHaveBeenCalledWith('Generating bundle...');
  expect(consola.success).toHaveBeenCalledWith(`Bundle created at: ${outputZip}`);
  expect(consola.info).toHaveBeenCalledWith(
    'Dry run enabled — skipping upload and deployment steps.',
  );
  expect(consola.info).toHaveBeenCalledWith('Next steps (skipped):');
  expect(consola.info).toHaveBeenCalledWith('- Generate upload signature');
  expect(consola.info).toHaveBeenCalledWith('- Upload bundle.zip');
  expect(consola.info).toHaveBeenCalledWith('- Create deployment');
  expect(exitMock).toHaveBeenCalledWith(0);
});

test('reads from env options', () => {
  const envVariables = parseEnvironmentVariables([
    'BIGCOMMERCE_STORE_HASH=123',
    'BIGCOMMERCE_STOREFRONT_TOKEN=456',
  ]);

  expect(envVariables).toEqual([
    {
      type: 'secret',
      key: 'BIGCOMMERCE_STORE_HASH',
      value: '123',
    },
    {
      type: 'secret',
      key: 'BIGCOMMERCE_STOREFRONT_TOKEN',
      value: '456',
    },
  ]);

  expect(() => parseEnvironmentVariables(['foo_bar'])).toThrow(
    'Invalid secret format: foo_bar. Expected format: KEY=VALUE',
  );
});
