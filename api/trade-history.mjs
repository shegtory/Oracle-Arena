import { send, telemetryFile } from './_telemetry.mjs';

export default async function handler(_req, res) {
  send(res, await telemetryFile('history.json', []));
}