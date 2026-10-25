import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import artwork from "../electron/artwork.cjs";
import api from "../electron/api.cjs";
export const defaultApiOrigin = "http://127.0.0.1:3200";

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
const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");
	if (!["GET", "HEAD"].includes(req.method) && !(url.pathname.startsWith("/api/") && req.method === "POST")) {
		res.writeHead(405);
		res.end();
		return;
	}

	if (url.pathname === "/art" || url.pathname.startsWith("/api/")) {
		if (
			url.pathname.startsWith("/api/") &&
			!api.allowedApiRequest(url.pathname.slice(4), req.method)
		) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}
		try {
			let requestBody;
			if (req.method === "POST") {
				const chunks = [];
				let size = 0;
				for await (const chunk of req) {
					size += chunk.length;
					if (size > 16384) { res.writeHead(413); res.end(); return; }
					chunks.push(chunk);
				}
				requestBody = Buffer.concat(chunks);
			}
			const response =
				url.pathname === "/art"
					? await artwork.fetchArtwork(url.searchParams.get("url"))
					: await api.proxyApi(url.pathname.slice(4), url.search, {
						method: req.method, headers: req.headers, body: requestBody,
					});
			res.writeHead(response.status, {
				"Content-Type":
					response.headers.get("content-type") || "application/json",
				"Cache-Control":
					url.pathname === "/art"
						? response.headers.get("cache-control") || "no-cache"
						: "no-store",
				"X-Content-Type-Options": "nosniff",
				...(response.headers.getSetCookie().length ? { "Set-Cookie": response.headers.getSetCookie() } : {}),
			});
			if (req.method === "HEAD" || !response.body) res.end();
			else
				Readable.fromWeb(response.body)
					.on("error", () => res.destroy())
					.pipe(res);
		} catch {
			res.writeHead(502, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "QQ Music API unavailable" }));
		}
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
	console.log(`qqmui: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => server.close());
