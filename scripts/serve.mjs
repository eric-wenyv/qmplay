import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".jpg": "image/jpeg",
	".png": "image/png",
};
const server = http.createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	if (!["GET", "HEAD"].includes(req.method)) {
		res.writeHead(405);
		res.end();
		return;
	}
	let requestPath;
	try {
		requestPath = decodeURIComponent(
			url.pathname === "/" ? "/index.html" : url.pathname,
		);
	} catch {
		res.writeHead(400);
		res.end();
		return;
	}
	const filename = path.resolve(root, "." + requestPath);
	const relative = path.relative(root, filename);
	const allowed =
		relative === "index.html" || /^(src|assets)[/\\]/.test(relative);
	if (
		!allowed ||
		relative.startsWith("..") ||
		path.isAbsolute(relative) ||
		!fs.existsSync(filename) ||
		!fs.statSync(filename).isFile()
	) {
		res.writeHead(404);
		res.end("Not found");
		return;
	}
	res.writeHead(200, {
		"Content-Type": mime[path.extname(filename)] || "application/octet-stream",
		"Cache-Control": "no-cache",
		"X-Content-Type-Options": "nosniff",
	});
	if (req.method === "HEAD") res.end();
	else fs.createReadStream(filename).pipe(res);
});
server.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
	console.log(`Interlude: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => server.close());
