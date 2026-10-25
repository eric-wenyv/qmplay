import test from 'node:test';
import assert from 'node:assert/strict';
import { FavoriteSync } from '../src/favorites.js';
const track = (id) => ({ id, title: id, songId: Number(id.slice(1)) || 1, songType: 0 });
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};
test('merges legacy likes once into the first account and keeps other accounts isolated', async () => {
  const storage = memory(),
    writes = [],
    snapshots = [];
  const provider = {
    getFavorites: async () => [track('r1')],
    setFavorite: async (value, liked) => {
      writes.push([value.id, liked]);
      return value;
    },
  };
  const sync = new FavoriteSync({
    provider,
    storage,
    legacy: [track('l2'), track('r1')],
    onChange: (value) => snapshots.push(value),
  });
  sync.connect('12345');
  await sync.sync();
  assert.deepEqual(
    snapshots.at(-1).map((value) => value.id),
    ['r1', 'l2'],
  );
  assert.deepEqual(writes, [['l2', true]]);
  const restarted = new FavoriteSync({
    provider,
    storage,
    onChange: (value) => snapshots.push(value),
  });
  restarted.connect('99999');
  assert.deepEqual(snapshots.at(-1), []);
  await restarted.sync();
  assert.equal(writes.length, 1);
  await restarted.set(track('b3'), true);
  restarted.connect('12345');
  assert.deepEqual(
    snapshots.at(-1).map((value) => value.id),
    ['r1', 'l2'],
  );
});
test('failed cloud writes leave the favorite unchanged, and failed reads preserve cached data', async () => {
  let snapshot;
  const provider = {
    getFavorites: async () => [track('r1')],
    setFavorite: async () => {
      throw Error('upstream rejected');
    },
  };
  const sync = new FavoriteSync({
    provider,
    storage: memory(),
    onChange: (value) => {
      snapshot = value;
    },
  });
  sync.connect('12345');
  await sync.sync();
  await assert.rejects(sync.set(track('r1'), false), /rejected/);
  assert.equal(snapshot.length, 1);
  provider.getFavorites = async () => {
    throw Error('offline');
  };
  await assert.rejects(sync.sync(), /offline/);
  assert.equal(snapshot[0].id, 'r1');
});
test('an account change ignores old reads/writes and does not copy favorites to the new account', async () => {
  let resolve, snapshot;
  const provider = {
    getFavorites: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  const sync = new FavoriteSync({
    provider,
    storage: memory(),
    onChange: (value) => {
      snapshot = value;
    },
  });
  sync.connect('12345');
  const reading = sync.sync();
  await Promise.resolve();
  sync.connect('99999');
  resolve([track('private1')]);
  await reading;
  assert.deepEqual(snapshot, []);
  assert.equal(sync.state.accounts['12345'], undefined);
});
test('serializes refresh and mutations, and coalesces duplicate clicks while a request is pending', async () => {
  let resolve,
    snapshot,
    calls = 0;
  const provider = {
    getFavorites: async () => [track('r1')],
    setFavorite: (value) => {
      calls++;
      return new Promise((done) => {
        resolve = () => done(value);
      });
    },
  };
  const sync = new FavoriteSync({
    provider,
    storage: memory(),
    onChange: (value) => {
      snapshot = value;
    },
  });
  sync.connect('12345');
  await sync.sync();
  const adding = sync.set(track('r2'), true);
  await Promise.resolve();
  assert.equal(await sync.set(track('r2'), true), false);
  assert.equal(calls, 1);
  resolve();
  assert.equal(await adding, true);
  assert.equal(snapshot.length, 2);
});
