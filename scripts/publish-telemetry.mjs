import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reconcileHistory } from './reconcile-history.mjs';
import { createRedeemDeps, redeemHistory } from './redeem-history.mjs';

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
async function readRemoteJson(path, fallback) {
  try {
    const file = await request(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch (error) {
    if (String(error).includes('404')) return fallback;
    throw error;
  }
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

const latest = JSON.parse(await readFile(resolve('bot', 'last-trade-receipt.json'), 'utf8'));
const localHistory = JSON.parse(await readFile(resolve('bot', 'trade-history.json'), 'utf8'));
const remoteHistory = await readRemoteJson('history.json', []);
let mergedHistory = await reconcileHistory([...(Array.isArray(localHistory) ? localHistory : []), ...(Array.isArray(remoteHistory) ? remoteHistory : [])]
  .filter((entry, index, all) => entry?.cycleId && all.findIndex((candidate) => candidate?.cycleId === entry.cycleId) === index)
  .sort((a, b) => (Date.parse(b.finishedAt || b.startedAt || 0) || 0) - (Date.parse(a.finishedAt || a.startedAt || 0) || 0)));
if (process.env.PRIVATE_KEY) {
  const deps=createRedeemDeps({rpc:process.env.RPC_URL||'https://rpc.ankr.com/somnia_testnet',moduleAddress:process.env.BINARY_MODULE||'0x3ecC694Cef705358864a646142ac17A90E29e388',privateKey:process.env.PRIVATE_KEY});
  deps.persistSubmitted=async(entry,redeem)=>{const checkpoint=mergedHistory.map(item=>item?.cycleId===entry?.cycleId?{...item,redeem}:item);await writeFile(resolve('bot','trade-history.json'),JSON.stringify(checkpoint,null,2))};
  const redeemDryRun=(process.env.REDEEM_DRY_RUN??'true').toLowerCase()!=='false'&&process.env.REDEEM_DRY_RUN!=='0';
  mergedHistory=await redeemHistory(mergedHistory,deps,{dryRun:redeemDryRun});
}
const publishedLatest=mergedHistory.find(entry=>entry?.cycleId===latest?.cycleId)??latest;

const files = [
  ['latest.json', publishedLatest],
  ['history.json', mergedHistory],
];
const tree = [];
for (const [path, value] of files) {
  const content = JSON.stringify(value, null, 2) + '\n';
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
