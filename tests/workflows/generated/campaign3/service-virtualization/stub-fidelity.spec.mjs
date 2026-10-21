// Stub fidelity: replay every recorded request against a live, unrouted Shop and fail when the
// response shape (status, media type, Retry-After / Set-Cookie presence, body field names and
// primitive types) no longer matches the cassette. Values are not compared. Also proves the
// comparator and the freshness gate on deliberately broken input (AGENTS.md: a detector needs a
// known-good and an intentionally broken case).
import { test, expect } from '../../../support/fixtures.mjs';
import { oracle } from '../../../support/oracle.mjs';
import { steps, runScenario, playwrightSender } from './scenario.mjs';
import { assertFresh, diffShapes, listRecordings, loadRecording, responseShape, shapeOf } from './cassette.mjs';

test('every recorded request still draws a response of the recorded shape from the live Shop', async ({ app, request }) => {
  const replayed = [];
  const drifted = {};
  await runScenario({
    send: playwrightSender(request, app.baseURL), users: app.users,
    onStep: (step, sent, live) => {
      const recording = loadRecording(step.name);
      expect(recording.request.method, step.name).toBe(sent.method);
      if (typeof step.path === 'string') expect(recording.request.path, step.name).toBe(sent.path);
      const differences = diffShapes(responseShape(recording.response), responseShape(live));
      expect.soft(differences, `${step.name}: ${sent.method} ${sent.path} drifted from recordings/${step.name}.json`).toEqual([]);
      if (differences.length) drifted[step.name] = differences;
      replayed.push(step.name);
    },
  });
  expect(replayed).toHaveLength(steps.length);
  expect([...replayed].sort()).toEqual(listRecordings());
  // Post-authoring edit for the controls matrix: one hard assertion over the same per-step
  // differences, so a designated failure can be verified under a response-shape fault.
  await oracle('c3-virt-catalog-drift', 'toEqual', () =>
    expect(drifted, 'recordings that drifted from the live Shop').toEqual({}));
});

test('the comparator flags a dropped field, a changed type, a changed status, an emptied array and a non-JSON body', () => {
  const recorded = loadRecording('orders-create').response;
  const against = live => diffShapes(responseShape(recorded), responseShape(live));

  expect(against(structuredClone(recorded))).toEqual([]);

  const dropped = structuredClone(recorded); delete dropped.body.replayed;
  expect(against(dropped)).toEqual(['body.replayed: missing in live response']);

  const retyped = structuredClone(recorded); retyped.body.order.amount = '4200';
  expect(against(retyped)).toEqual(['body.order.amount: "number" -> "string"']);

  const restatused = structuredClone(recorded); restatused.status = 200;
  expect(against(restatused)).toEqual(['status: 201 -> 200']);

  const emptied = structuredClone(recorded); emptied.body.order.items = [];
  expect(against(emptied)).toEqual(['body.order.items[0]: {"quantity":"number","sku":"string"} -> "empty"']);

  const added = structuredClone(recorded); added.body.order.coupon = null;
  expect(against(added)).toEqual(['body.order.coupon: new in live response']);

  expect(against({ ...recorded, body: null, unparsable: '<html>Bad gateway</html>' }))
    .toEqual([`body: ${JSON.stringify(shapeOf(recorded.body))} -> "unparsable"`]);
});

test('the freshness gate accepts every current recording and rejects a 31-day-old stamp', () => {
  const names = listRecordings();
  expect(names).toHaveLength(steps.length);
  for (const name of names) expect(() => loadRecording(name), name).not.toThrow();
  const day = 86_400_000;
  expect(() => assertFresh(new Date(Date.now() - 29 * day).toISOString())).not.toThrow();
  expect(() => assertFresh(new Date(Date.now() - 31 * day).toISOString(), 'Recording x')).toThrow(/Recording x is 31 days old \(>30\)\. Re-record it\./);
  expect(() => assertFresh(undefined)).toThrow(/no usable recordedAt/);
});
