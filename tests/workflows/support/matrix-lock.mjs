import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, linkSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

// Publish a complete record atomically. No other process can observe an empty
// newly-created lock and mistake it for a stale owner.
function createExclusive(file, record) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(record));
    linkSync(temporary, file); // EEXIST means another owner won; never replace it.
  } finally {
    closeSync(fd);
    unlinkSync(temporary);
  }
}

function readOwner(file) {
  let owner;
  try { owner = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot establish matrix lock ownership at ${file}; use a fresh QA_MATRIX_OUTPUT directory`);
  }
  if (owner?.schemaVersion !== 1 || !Number.isInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.token !== 'string' || owner.host !== hostname() ||
      !(owner.childPid === null || (Number.isInteger(owner.childPid) && owner.childPid > 0))) {
    throw new Error(`Matrix lock ownership is ambiguous at ${file}; use a fresh QA_MATRIX_OUTPUT directory`);
  }
  return owner;
}

function assertDead(owner, file) {
  if (owner && (alive(owner.pid) || alive(owner.childPid))) {
    throw new Error(`Matrix output is in use by PID ${owner.pid}${owner.childPid ? ` (child ${owner.childPid})` : ''}: ${file}`);
  }
}

export function acquireMatrixLock(directory) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, '.matrix.lock');
  const record = { schemaVersion: 1, pid: process.pid, childPid: null, host: hostname(), token: randomUUID(), createdAt: new Date().toISOString() };
  try { createExclusive(file, record); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assertDead(readOwner(file), file);
    // Serialize stale-owner recovery. A crashed recovery is ambiguous, so fail
    // promptly with a fresh-output remedy rather than deleting an unknown lock.
    const reclaim = `${file}.reclaim`;
    try { createExclusive(reclaim, record); }
    catch (reclaimError) {
      if (reclaimError.code === 'EEXIST') throw new Error(`Matrix lock recovery already exists at ${reclaim}; use a fresh QA_MATRIX_OUTPUT directory`);
      throw reclaimError;
    }
    try {
      const existing = readOwner(file);
      assertDead(existing, file);
      if (existing) {
        try { unlinkSync(file); } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
      }
      createExclusive(file, record);
    } finally { unlinkSync(reclaim); }
  }
  return {
    child(pid) {
      const current = readOwner(file);
      if (current?.token !== record.token) throw new Error('Matrix output lock was replaced');
      record.childPid = pid;
      writeFileSync(file, JSON.stringify(record));
    },
    release() {
      if (readOwner(file)?.token === record.token) unlinkSync(file);
    },
  };
}
