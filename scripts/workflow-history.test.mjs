import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('cycle workflow hydrates published history before running the model', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cycle.yml', import.meta.url), 'utf8');
  const hydrate = workflow.indexOf('name: Hydrate published cycle history');
  const run = workflow.indexOf('name: Run cycle');

  assert.ok(hydrate >= 0, 'history hydration step is missing');
  assert.ok(run > hydrate, 'history must be hydrated before the cycle starts');
  assert.match(workflow, /telemetry\/history\.json/);
  assert.match(workflow, /Published history must be an array/);
});
