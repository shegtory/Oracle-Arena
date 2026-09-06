import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || 'shegtory/Oracle-Arena';
const branch = process.env.TELEMETRY_BRANCH || 'telemetry';
if (!token) throw new Error('GITHUB_TOKEN is required to publish telemetry');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};
const api = `https://api.github.com/repos/${repository}`;

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

let parent;
try {
  parent = (await request(`/git/ref/heads/${branch}`)).object.sha;
} catch (error) {
  if (!String(error).includes('404')) throw error;
  const main = (await request('/git/ref/heads/main')).object.sha;
  await request('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main }) });
  parent = main;
}

const files = [
  ['latest.json', resolve('bot', 'last-trade-receipt.json')],
  ['history.json', resolve('bot', 'trade-history.json')],
];
const tree = [];
for (const [path, source] of files) {
  const content = JSON.stringify(JSON.parse(await readFile(source, 'utf8')), null, 2) + '\n';
  const blob = await request('/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'utf-8' }),
  });
  tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
}
const createdTree = await request('/git/trees', {
  method: 'POST',
  body: JSON.stringify({ tree }),
});
const commit = await request('/git/commits', {
  method: 'POST',
  body: JSON.stringify({
    message: `Publish cycle telemetry ${new Date().toISOString()}`,
    tree: createdTree.sha,
    parents: [parent],
  }),
});
await request(`/git/refs/heads/${branch}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
console.log(`Published telemetry at ${commit.sha}`);