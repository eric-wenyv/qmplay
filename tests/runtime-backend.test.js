import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import lifecycle from '../electron/backend.cjs';

function fixture(options = {}) {
  const children = [], environments = [];
  const controller = lifecycle.createBackendController({
    entry: '/application/dist/backend/server.cjs',
    authDirectory: '/profiles/qmplay/auth',
    env: { EXISTING: 'preserved', PORT: '3200' },
    timeout: 100,
    spawn: (entry, env) => {
      assert.equal(entry, '/application/dist/backend/server.cjs');
      environments.push(env);
      const child = new EventEmitter();
      child.kill = () => { child.killed = true; child.emit('exit', 0); };
      children.push(child);
      return child;
    },
    ...options,
  });
  return { controller, children, environments };
}
test('backend start waits for trusted readiness and shares one child among concurrent requests', async t => {
  const { controller, children, environments } = fixture();
  t.after(() => controller.stop());
  const first = controller.start(), second = controller.start();
  assert.equal(children.length, 1);
  assert.equal(environments[0].PORT, '0');
  assert.equal(environments[0].QQ_MUSIC_AUTH_DIR, '/profiles/qmplay/auth');
  assert.equal(environments[0].EXISTING, 'preserved');
  assert.match(environments[0].QMPLAY_API_TOKEN, /^[a-f0-9]{64}$/);
  children[0].emit('message', { type: 'ready', origin: 'http://127.0.0.1:43210' });
  const connection = await first;
  assert.deepEqual(await second, connection);
  assert.equal(connection.token, environments[0].QMPLAY_API_TOKEN);
  assert.equal(await controller.start(), connection);
});
test('backend crash starts a fresh private child on retry without changing authentication storage', async t => {
  const { controller, children, environments } = fixture();
  t.after(() => controller.stop());
  const first = controller.start();
  children[0].emit('message', { type: 'ready', origin: 'http://127.0.0.1:43210' });
  const old = await first;
  children[0].emit('exit', 1);
  const retried = controller.start();
  children[1].emit('message', { type: 'ready', origin: 'http://127.0.0.1:43211' });
  const current = await retried;
  assert.equal(current.origin, 'http://127.0.0.1:43211');
  assert.notEqual(current.token, old.token);
  assert.equal(environments[1].QQ_MUSIC_AUTH_DIR, environments[0].QQ_MUSIC_AUTH_DIR);
});
test('backend rejects non-loopback readiness and shutdown kills its owned child', async () => {
  const { controller, children } = fixture();
  const startup = controller.start();
  children[0].emit('message', { type: 'ready', origin: 'http://example.com:43210' });
  await assert.rejects(startup, /启动失败/);
  assert.equal(children[0].killed, true);
  const next = controller.start();
  children[1].emit('message', { type: 'ready', origin: 'http://127.0.0.1:43210' });
  await next;
  controller.stop();
  assert.equal(children[1].killed, true);
  await assert.rejects(controller.start(), /已停止/);
});
test('backend fails startup on early exit and bounds repeated failed launches', async t => {
  const { controller, children } = fixture();
  t.after(() => controller.stop());
  for (let index = 0; index < 3; index++) {
    const attempt = controller.start();
    children[index].emit('exit', 1);
    await assert.rejects(attempt, /启动失败/);
  }
  await assert.rejects(controller.start(), /多次启动失败/);
  assert.equal(children.length, 3);
});

test('a timed-out child cannot later publish a connection or token', async t => {
  const { controller, children } = fixture({ timeout: 5 });
  t.after(() => controller.stop());
  const failed = assert.rejects(controller.start(), /启动失败/);
  await new Promise(resolve => setTimeout(resolve, 20));
  await failed;
  assert.equal(children[0].killed, true);
  children[0].emit('message', { type: 'ready', origin: 'http://127.0.0.1:43210' });
  const retried = controller.start();
  assert.equal(children.length, 2);
  children[1].emit('message', { type: 'ready', origin: 'http://127.0.0.1:43211' });
  assert.equal((await retried).origin, 'http://127.0.0.1:43211');
});
