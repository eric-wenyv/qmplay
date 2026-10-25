import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ensureBackend } from "./backend.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
try {
	const backend = await ensureBackend();
	try {
		const require = createRequire(import.meta.url);
		const electron = require("electron");
		const child = spawn(electron, ["."], {
			cwd: root,
			stdio: "inherit",
			env: process.env,
		});
		child.once("error", (error) => {
			console.error(error.message);
			backend?.kill("SIGTERM");
			process.exitCode = 1;
		});
		child.once("exit", (code) => {
			backend?.kill("SIGTERM");
			process.exitCode = code || 0;
		});
		for (const signal of ["SIGINT", "SIGTERM"])
			process.on(signal, () => {
				child.kill(signal);
				backend?.kill("SIGTERM");
			});
	} catch (error) {
		backend?.kill("SIGTERM");
		throw error;
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
