import { ensureBackend } from "./backend.mjs";
try {
	const backend = await ensureBackend();
	for (const signal of ["SIGINT", "SIGTERM"])
		process.on(signal, () => backend?.kill("SIGTERM"));
	await import("./serve.mjs");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
