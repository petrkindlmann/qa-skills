import { oracle } from '../../../../../support/oracle.mjs';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, json, basket, sessionCookie, state, payment, deliver } from './helpers.mjs';

// The fixture publishes its SQLite path; these checks read the data the API never shows.
function openReadOnly(app) {
  const db = new DatabaseSync(app.databasePath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

test('session credentials are stored hashed at rest and removed on logout', async ({ app, clients }) => {
  const cookie = await sessionCookie(clients.alice);
  const db = openReadOnly(app);
  try {
    const rows = db.prepare('SELECT token_hash, user_id FROM sessions ORDER BY user_id').all();
    expect(rows.map(row => row.user_id)).toEqual(['alice', 'bob']);
    for (const row of rows) {
      await oracle('shop-plaintext-sessions', 'toMatch', () => expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/));
      expect(row.token_hash).not.toBe(cookie);
      expect(row.token_hash).not.toContain(cookie);
    }
    const passwords = db.prepare('SELECT password FROM users').all().map(row => row.password);
    expect(passwords).toHaveLength(2);
    for (const stored of passwords) {
      expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
      expect(stored).not.toContain(app.users.alice.password);
    }
    expect((await clients.alice.post('/api/logout')).status()).toBe(204);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'alice'").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'bob'").get().count).toBe(1);
  } finally {
    db.close();
  }
});

test('schema enforces idempotency uniqueness, foreign keys and durable journaling', async ({ app, clients }) => {
  const { order } = await json(await clients.alice.post('/api/orders', { headers: { 'Idempotency-Key': 'schema-check' }, data: basket }), 201);
  const db = new DatabaseSync(app.databasePath);
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
    const uniqueColumns = db.prepare("PRAGMA index_list('orders')").all()
      .filter(index => index.unique === 1)
      .map(index => db.prepare(`PRAGMA index_info('${index.name}')`).all().map(column => column.name).sort());
    await oracle('shop-missing-idempotency-index', 'toContainEqual', () => expect(uniqueColumns, 'a unique index must cover (user_id, idem_key)').toContainEqual(['idem_key', 'user_id']));
    const references = db.prepare("PRAGMA foreign_key_list('orders')").all().map(fk => `${fk.from}->${fk.table}.${fk.to}`);
    expect(references).toEqual(['user_id->users.id']);

    // Constraint test: a second row with the same key and user must be refused by the database itself.
    db.exec('BEGIN IMMEDIATE');
    try {
      const attempt = () => db.prepare(
        'INSERT INTO orders (id, user_id, idem_key, intent_hash, items, currency, amount, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('duplicate-row', order.user_id, 'schema-check', 'x', '[]', 'EUR', 1, 0);
      expect(attempt).toThrow(/UNIQUE constraint failed: orders\.user_id, orders\.idem_key/);
    } finally {
      db.exec('ROLLBACK');
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE idem_key = 'schema-check'").get().count).toBe(1);
  } finally {
    db.close();
  }
});

test('orders, receipts and sessions stay referentially consistent after payment and logout', async ({ app, clients, request }) => {
  const { order } = await json(await clients.alice.post('/api/orders', { headers: { 'Idempotency-Key': 'integrity' }, data: basket }), 201);
  expect(await json(await deliver(app, request, payment(order, 'evt-integrity')), 200))
    .toEqual({ received: true, duplicate: false, order_id: order.id });
  expect((await clients.bob.post('/api/logout')).status()).toBe(204);

  const observed = await state(app, request);
  expect(observed.receipts.map(receipt => receipt.order_id)).toEqual([order.id]);
  const db = openReadOnly(app);
  try {
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const orphans = {
      receipts: db.prepare('SELECT r.id FROM receipts r LEFT JOIN orders o ON o.id = r.order_id WHERE o.id IS NULL').all(),
      orders: db.prepare('SELECT o.id FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL').all(),
      sessions: db.prepare('SELECT s.user_id FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL').all(),
    };
    expect(orphans).toEqual({ receipts: [], orders: [], sessions: [] });
    expect(db.prepare('SELECT status, fulfillment_count FROM orders WHERE id = ?').get(order.id)).toEqual({ status: 'paid', fulfillment_count: 1 });
    expect(db.prepare('SELECT user_id, COUNT(*) AS count FROM sessions GROUP BY user_id').all()).toEqual([{ user_id: 'alice', count: 1 }]);
  } finally {
    db.close();
  }
});
