const {
	app,
	BrowserWindow,
	ipcMain,
	protocol,
	net,
	Menu,
	Tray,
	session,
	utilityProcess,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const os = require("node:os");
const { createBackendController } = require("./backend.cjs");
const { fetchArtwork } = require("./artwork.cjs");
const { API_ORIGIN, proxyApi } = require("./api.cjs");
const { authCookieHeader, storeAuthCookies } = require("./auth-cookies.cjs");

app.setName("qmplay");
if (process.platform === "win32") app.setAppUserModelId("app.qmplay");
// Reuse an existing desktop profile to preserve login cookies and local playback state.
const appData = app.getPath("appData");
const userData = ["qmplay", "qqmui", "Interlude", "间奏", "interlude-player"]
	.map((name) => path.join(appData, name))
	.find((directory) => fs.existsSync(directory)) || path.join(appData, "qmplay");
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setPath("sessionData", userData);
// Existing profiles keep their origin so their local playback and favorite data remain accessible.
const scheme = path.basename(userData) === "qmplay" ? "qmplay" : "interlude";
const appOrigin = `${scheme}://app`;
protocol.registerSchemesAsPrivileged([
	{
		scheme,
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
		},
	},
]);
const legacyAuthDirectory = path.join(os.homedir(), ".local/share/qq-music-api/auth");
const backend = createBackendController({
	entry: path.join(__dirname, "../dist/backend/server.cjs"),
	authDirectory: process.env.QQ_MUSIC_AUTH_DIR ||
		(fs.existsSync(legacyAuthDirectory) ? legacyAuthDirectory : path.join(userData, "auth")),
	spawn: (entry, env) => utilityProcess.fork(entry, [], {
		env, cwd: userData, stdio: "pipe", serviceName: "qmplay Music API",
	}),
});
let window;
let tray;
let quitting = false;
const rendererRoot = fs.existsSync(path.join(__dirname, "../dist/index.html"))
	? path.join(__dirname, "../dist")
	: path.join(__dirname, "..");

function createWindow() {
	window = new BrowserWindow({
		width: 540,
		height: 580,
		minWidth: 380,
		minHeight: 520,
		backgroundColor: "#00000000",
		transparent: true,
		title: "qmplay · QQ 音乐播放器",
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
			// Keep playback events and track changes running while the window is hidden.
			backgroundThrottling: false,
		},
	});
	window.once("ready-to-show", () => window.show());
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.session.setPermissionRequestHandler(
		(_contents, _permission, callback) => callback(false),
	);
	window.loadURL(`${appOrigin}/index.html`);
	window.on("close", (event) => {
		if (quitting) return;
		event.preventDefault();
		window.hide();
	});
	window.on("closed", () => {
		window = null;
	});
}

function showWindow() {
	if (quitting) return;
	if (!window) {
		createWindow();
		return;
	}
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
}

function createTray() {
	tray = new Tray(path.join(rendererRoot, "assets/icon.png"));
	tray.setToolTip("qmplay");
	tray.setContextMenu(Menu.buildFromTemplate([
		{ label: "显示", click: showWindow },
		{ label: "退出", click: () => app.quit() },
	]));
	tray.on("click", showWindow);
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else app.whenReady().then(async () => {
	// A failed launch remains retryable through the existing authentication error UI.
	await backend.start().catch(() => {});
	protocol.handle(scheme, async (request) => {
		const url = new URL(request.url);
		if (url.host !== "app")
			return new Response("Not found", { status: 404 });
		if (url.pathname.startsWith("/api/")) {
			try {
				const cookies = await session.defaultSession.cookies.get({ url: API_ORIGIN });
				const response = await proxyApi(url.pathname.slice(4), url.search, {
					method: request.method,
					connection: await backend.start(),
					headers: { "Content-Type": "application/json", Origin: appOrigin,
						Cookie: authCookieHeader(cookies) },
					body: request.method === "POST" ? await request.text() : undefined,
				});
				await storeAuthCookies(session.defaultSession.cookies, response.headers);
				const headers = new Headers(response.headers);
				headers.delete("set-cookie");
				headers.delete("x-qmplay-token");
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
	createTray();
	createWindow();
	app.on("activate", showWindow);
	app.on("second-instance", showWindow);
});
app.on("before-quit", () => {
	quitting = true;
	backend.stop();
});
app.on("will-quit", () => {
	tray?.destroy();
	tray = null;
});
// The tray owns the application lifetime; closing a window must not end playback.
app.on("window-all-closed", () => {});
