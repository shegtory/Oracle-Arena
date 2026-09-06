import { send, telemetryFile } from './_telemetry.mjs';

export default async function handler(_req, res) {
  const data = await telemetryFile('latest.json', null);
  send(res, data ?? { error: 'No trade receipt has been published' }, data ? 200 : 503);
}