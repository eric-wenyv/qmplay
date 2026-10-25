import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function ensureBackend() {
	const address = "http://127.0.0.1:3200";
	try {
		const response = await fetch(`${address}/explorer/metadata`, {
			signal: AbortSignal.timeout(1500),
		});
		if (response.ok && Array.isArray((await response.json()).endpoints))
			return null;
	} catch {
		/* Start the adjacent checkout if a service is not already running. */
	}
	const directory =
		process.env.QQ_MUSIC_API_DIR ||
		fileURLToPath(new URL("../../qq-music-api/", import.meta.url));
	if (
		!existsSync(`${directory}/node_modules/ts-node/register/transpile-only.js`)
	)
		throw new Error(`未找到 API 依赖。请在 ${directory} 执行 npm install。`);
	const child = spawn(
		process.execPath,
		["-r", "ts-node/register/transpile-only", "src/app.ts"],
		{
			cwd: directory,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PORT: "3200", AUTO_OPEN_EXPLORER: "false" },
		},
	);
	// The upstream server can log signed links; do not copy these into the renderer.
	let spawnError = null;
	child.stdout.resume();
	child.stderr.resume();
	child.on("error", (error) => {
		spawnError = error;
	});
	const cleanup = () => {
		if (child.exitCode === null) child.kill("SIGTERM");
	};
	process.once("exit", cleanup);
	for (let attempt = 0; attempt < 50; attempt++) {
		if (spawnError || child.exitCode !== null) {
			cleanup();
			throw new Error(
				`音乐服务启动失败（${child.exitCode}）。请手动运行 qq-music-api 检查配置。`,
			);
		}
		try {
			const response = await fetch(`${address}/explorer/metadata`, {
				signal: AbortSignal.timeout(500),
			});
			if (response.ok) {
				console.log(`QQ Music API: ${address}`);
				return child;
			}
		} catch {
			/* Wait for startup. */
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	cleanup();
	throw new Error("音乐服务启动超时，请手动启动 qq-music-api 后重试。");
}
