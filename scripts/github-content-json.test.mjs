import test from 'node:test';
import assert from 'node:assert/strict';
import { readGithubContentJson } from './github-content-json.mjs';

const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

test('reads inline JSON returned by the Contents API', async () => {
  const calls = [];
  const value = [{ cycleId: 'inline' }];
  const request = async (path) => {
    calls.push(path);
    return { encoding: 'base64', content: encoded(value), sha: 'unused' };
  };
  assert.deepEqual(await readGithubContentJson(request, 'history.json', 'telemetry', []), value);
  assert.deepEqual(calls, ['/contents/history.json?ref=telemetry']);
});

test('reads the Git blob when Contents API omits files over 1 MiB', async () => {
  const calls = [];
  const value = [{ cycleId: 'large-history' }];
  const request = async (path) => {
    calls.push(path);
    if (path.startsWith('/contents/')) return { encoding: 'none', content: '', sha: 'large-blob-sha' };
    return { encoding: 'base64', content: encoded(value), sha: 'large-blob-sha' };
  };
  assert.deepEqual(await readGithubContentJson(request, 'history.json', 'telemetry', []), value);
  assert.deepEqual(calls, [
    '/contents/history.json?ref=telemetry',
    '/git/blobs/large-blob-sha',
  ]);
});

test('preserves the missing-file fallback without hiding malformed JSON', async () => {
  await assert.doesNotReject(async () => {
    const result = await readGithubContentJson(async () => { throw new Error('GET: 404 Not Found'); }, 'history.json', 'telemetry', []);
    assert.deepEqual(result, []);
  });
  await assert.rejects(
    readGithubContentJson(async () => ({ encoding: 'base64', content: Buffer.from('{').toString('base64'), sha: 'bad' }), 'history.json', 'telemetry', []),
    SyntaxError,
  );
});
