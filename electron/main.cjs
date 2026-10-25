const {
	app,
	BrowserWindow,
	ipcMain,
	protocol,
	net,
	Menu,
	session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { fetchArtwork } = require("./artwork.cjs");
const { API_ORIGIN, proxyApi } = require("./api.cjs");
const { authCookieHeader, storeAuthCookies } = require("./auth-cookies.cjs");

// Keep the established origin so existing local playback and favorite data remain accessible.
protocol.registerSchemesAsPrivileged([
	{
		scheme: "interlude",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
		},
	},
]);
app.setName("qqmui");
// Reuse an existing desktop profile to preserve login cookies and local playback state.
const appData = app.getPath("appData");
const userData = ["qqmui", "Interlude", "间奏", "interlude-player"]
	.map((name) => path.join(appData, name))
	.find((directory) => fs.existsSync(directory)) || path.join(appData, "qqmui");
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setPath("sessionData", userData);
let window;
const rendererRoot = fs.existsSync(path.join(__dirname, "../dist/index.html"))
	? path.join(__dirname, "../dist")
	: path.join(__dirname, "..");

function createWindow() {
	window = new BrowserWindow({
		width: 540,
		height: 580,
		minWidth: 380,
		minHeight: 520,
		backgroundColor: "#665e50",
		title: "qqmui · qq music ui",
		frame: false,
		show: false,
		autoHideMenuBar: true,
		icon: path.join(rendererRoot, "assets/icon.png"),
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
		},
	});
	window.once("ready-to-show", () => window.show());
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.session.setPermissionRequestHandler(
		(_contents, _permission, callback) => callback(false),
	);
	window.loadURL("interlude://app/index.html");
	window.on("closed", () => {
		window = null;
	});
}

app.whenReady().then(() => {
	protocol.handle("interlude", async (request) => {
		const url = new URL(request.url);
		if (url.host !== "app")
			return new Response("Not found", { status: 404 });
		if (url.pathname.startsWith("/api/")) {
			try {
				const cookies = await session.defaultSession.cookies.get({ url: API_ORIGIN });
				const response = await proxyApi(url.pathname.slice(4), url.search, {
					method: request.method,
					headers: { "Content-Type": "application/json", Origin: "interlude://app",
						Cookie: authCookieHeader(cookies) },
					body: request.method === "POST" ? await request.text() : undefined,
				});
				await storeAuthCookies(session.defaultSession.cookies, response.headers);
				const headers = new Headers(response.headers);
				headers.delete("set-cookie");
				headers.set("Cache-Control", "no-store");
				return new Response(response.body, { status: response.status, headers });
			} catch {
				return Response.json({ error: { code: "API_UNAVAILABLE", message: "无法连接本地音乐服务，请重试" } }, { status: 502 });
			}
		}
		if (request.method !== "GET") return new Response("Not found", { status: 404 });
		if (url.pathname === "/art")
			return fetchArtwork(url.searchParams.get("url"));
		let resourcePath;
		try {
			resourcePath = decodeURIComponent(url.pathname);
		} catch {
			return new Response("Bad request", { status: 400 });
		}
		const filename = path.resolve(rendererRoot, "." + resourcePath);
		const relative = path.relative(rendererRoot, filename);
		const allowed =
			relative === "index.html" || /^(src|assets)[/\\]/.test(relative);
		if (
			!allowed ||
			relative.startsWith("..") ||
			path.isAbsolute(relative) ||
			!fs.existsSync(filename) ||
			!fs.statSync(filename).isFile()
		)
			return new Response("Not found", { status: 404 });
		return net.fetch(pathToFileURL(filename).toString());
	});
	Menu.setApplicationMenu(
		process.platform === "darwin"
			? Menu.buildFromTemplate([
					{ role: "appMenu" },
					{ role: "editMenu" },
					{ role: "windowMenu" },
				])
			: null,
	);
	for (const action of ["minimize", "close"]) {
		ipcMain.on(`window:${action}`, (event) => {
			if (
				window &&
				event.sender === window.webContents &&
				event.senderFrame === window.webContents.mainFrame
			)
				window[action]();
		});
	}
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
