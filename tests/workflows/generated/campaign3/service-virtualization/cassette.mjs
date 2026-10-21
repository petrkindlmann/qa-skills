// Cassette helpers, after skills/service-virtualization/references/record-replay.md:
// `{ recordedAt, request, response }` per file and a 30-day expiry that fails the test
// instead of letting a stale recording pass silently.
import { readFileSync, readdirSync } from 'node:fs';

const MAX_AGE_DAYS = 30;

export function assertFresh(recordedAt, name = 'Cassette') {
  const ageDays = (Date.now() - new Date(recordedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays)) throw new Error(`${name} has no usable recordedAt stamp (${recordedAt}). Re-record it.`);
  if (ageDays > MAX_AGE_DAYS) {
    throw new Error(`${name} is ${Math.floor(ageDays)} days old (>${MAX_AGE_DAYS}). Re-record it.`);
  }
}

export const recordingsDir = new URL('./recordings/', import.meta.url);

export function loadRecording(name) {
  const recording = JSON.parse(readFileSync(new URL(`${name}.json`, recordingsDir), 'utf8'));
  assertFresh(recording.recordedAt, `Recording ${name}`);
  return recording;
}

export function listRecordings() {
  return readdirSync(recordingsDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
}

// Type signature of a JSON value: field names and primitive types, values dropped.
// Arrays are described by their first element ('empty' when there is none).
export function shapeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return [value.length ? shapeOf(value[0]) : 'empty'];
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, shapeOf(value[key])]));
  }
  return typeof value;
}

// What the fidelity check compares: status, media type, presence of Retry-After and
// Set-Cookie, and the body signature. Never values (ids, emails, amounts differ per run).
export function responseShape(response) {
  const headers = response.headers ?? {};
  return {
    status: response.status,
    contentType: headers['content-type'] ? headers['content-type'].split(';')[0].trim() : null,
    retryAfter: 'retry-after' in headers,
    setCookie: 'set-cookie' in headers,
    body: response.unparsable !== undefined ? 'unparsable' : shapeOf(response.body),
  };
}

// Human-readable list of differences; empty means the live response still matches.
export function diffShapes(recorded, live, prefix = '') {
  if (Array.isArray(recorded) || Array.isArray(live)) {
    if (!Array.isArray(recorded) || !Array.isArray(live)) return [`${prefix || '$'}: ${JSON.stringify(recorded)} -> ${JSON.stringify(live)}`];
    return diffShapes(recorded[0], live[0], `${prefix}[0]`);
  }
  if (typeof recorded !== 'object' || typeof live !== 'object' || recorded === null || live === null) {
    return recorded === live ? [] : [`${prefix || '$'}: ${JSON.stringify(recorded)} -> ${JSON.stringify(live)}`];
  }
  const differences = [];
  for (const key of new Set([...Object.keys(recorded), ...Object.keys(live)])) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in live)) differences.push(`${path}: missing in live response`);
    else if (!(key in recorded)) differences.push(`${path}: new in live response`);
    else differences.push(...diffShapes(recorded[key], live[key], path));
  }
  return differences;
}
