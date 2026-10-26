const { randomBytes } = require('node:crypto');

function validOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      Number(url.port) > 0 && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash && url.origin === value;
  } catch {
    return false;
  }
}

// The launcher owns the child and its secret. Neither is supplied by the renderer.
function createBackendController({ spawn, entry, env = process.env, authDirectory, timeout = 15000 }) {
  let child, connection, pending, stopped = false;
  const attempts = [];
  function start() {
    if (stopped) return Promise.reject(new Error('音乐服务已停止'));
    if (connection) return Promise.resolve(connection);
    if (pending) return pending;
    const now = Date.now();
    while (attempts.length && attempts[0] < now - 60000) attempts.shift();
    if (attempts.length >= 3)
      return Promise.reject(new Error('音乐服务多次启动失败，请稍后重试或重新打开应用'));
    attempts.push(now);
    const token = randomBytes(32).toString('hex');
    pending = new Promise((resolve, reject) => {
      let settled = false, timer;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('内置音乐服务启动失败，请重试或重新打开应用'));
      };
      try {
        const launched = spawn(entry, {
          ...env,
          PORT: '0',
          QMPLAY_API_TOKEN: token,
          ...(authDirectory ? { QQ_MUSIC_AUTH_DIR: authDirectory } : {}),
        });
        child = launched;
        launched.stdout?.resume();
        // Avoid forwarding signed URLs, cookies or upstream response bodies to the UI/logs.
        launched.stderr?.resume();
        launched.on('error', () => {
          if (child === launched) { child = undefined; connection = undefined; }
          launched.kill();
          fail();
        });
        launched.once('exit', () => {
          if (child === launched) { child = undefined; connection = undefined; }
          fail();
        });
        launched.on('message', (message) => {
          if (settled || message?.type !== 'ready') return;
          if (!validOrigin(message.origin)) {
            launched.kill();
            fail();
            return;
          }
          settled = true;
          clearTimeout(timer);
          connection = Object.freeze({ origin: message.origin, token });
          resolve(connection);
        });
        timer = setTimeout(() => { launched.kill(); fail(); }, timeout);
        timer.unref?.();
      } catch {
        fail();
      }
    }).finally(() => { pending = undefined; });
    return pending;
  }
  function stop() {
    stopped = true;
    connection = undefined;
    child?.kill();
  }
  return { start, stop };
}

module.exports = { createBackendController, validOrigin };
