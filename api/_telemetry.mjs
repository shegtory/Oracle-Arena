import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_REMOTE = 'https://raw.githubusercontent.com/shegtory/Oracle-Arena/telemetry';

async function readLocal(name) {
  const localName = name === 'latest.json' ? 'last-trade-receipt.json' : name === 'history.json' ? 'trade-history.json' : name;
  const paths = [
    resolve(process.cwd(), 'bot', localName),
    resolve(process.cwd(), '..', 'bot', localName),
  ];
  for (const path of paths) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {}
  }
  return undefined;
}

async function readRemote(name) {
  const base = (process.env.TELEMETRY_BASE_URL || DEFAULT_REMOTE).replace(/\/$/, '');
  const response = await fetch(`${base}/${name}?v=${Date.now()}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Telemetry store returned ${response.status}`);
  return response.json();
}

export async function telemetryFile(name, fallback) {
  const readers = process.env.VERCEL ? [readRemote, readLocal] : [readLocal, readRemote];
  for (const reader of readers) {
    try {
      const value = await reader(name);
      if (value !== undefined) return value;
    } catch {}
  }
  return fallback;
}

export function send(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(value));
}