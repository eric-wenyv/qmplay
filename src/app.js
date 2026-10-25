import { icon } from "./icons.js";
import { QQMusicProvider, artworkUrl } from "./api.js";
import { AudioTransport } from "./audio.js";
import { readLibrary, writeLibrary, rememberArtist } from "./storage.js";
import { PlayerSession, formatTime, orderLabels } from "./player.js";
import { Authentication } from "./auth.js";
import { FavoriteSync } from "./favorites.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const session = new PlayerSession();
const preferences = readLibrary();
const liked = new Map();
let activeUser = null;
let authReady = false;
let playerStarted = false;
const audio = new Audio();
const provider = new QQMusicProvider({
	supportedQualities: [
		["flac", "audio/flac"],
		["320", "audio/mpeg"],
		["128", "audio/mpeg"],
		["m4a", "audio/mp4"],
	]
		.filter(([, mime]) => audio.canPlayType(mime))
		.map(([quality]) => quality),
});
let view = "player";
let loading = false;
let sourceLoading = false;
let sourceVersion = 0;
let trackVersion = 0;
let searchVersion = 0;
let searchAbort = null;
let followerObserver = null;
let searchTimer;
let sourceRetry = null;
let modeMenuOpen = false;
let lyrics = [];
let lyricsVersion = 0;
let lyricsId = null;
let activeLyric = -1;
let lastSaved = 0;
let storageWarning = false;
let moreRequest = null;
let playlistAbort = null;
let albumCatalog = null;
let recentArtists = preferences.artistHistory || [];
let advanceVersion = 0;
let queueWindow = "";
const mobileLayout = window.matchMedia("(max-width: 560px), (pointer: coarse) and (max-width: 1024px)");
let swipeStart = null;
let suppressClickUntil = 0;
let mobilePage = null;
let mobileMode = ({ liked: "liked", artist: "artist", album: "artist" })[preferences.queueSource?.type] || "radio";
let radioVersion = 0;
const pageModes = { search: "artist", albums: "artist", browse: "radio", liked: "liked", queue: "queue" };
const artworkThemes = new Map();
let themedArtwork = null;
const modeLabels = {
	home: "主页",
	radio: "推荐电台",
	liked: "喜欢的音乐",
	artist: "歌手电台",
	album: "歌手电台",
	queue: "播放队列",
};
const modeIcons = { home: "home", radio: "radio", liked: "heart", artist: "artist", album: "artist", queue: "queue" };

function escapeHtml(value) {
	return String(value ?? "").replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			],
	);
}
function announce(message) {
	$("#announcement").textContent = message;
}
function notify(message, retry = null) {
	if (!$("#queue-panel").hidden) $("#queue-message").textContent = message;
	$("#notice-message").textContent = message;
	$("#notice").hidden = false;
	$("#notice-action").hidden = !retry;
	$("#notice-action").onclick = retry
		? () => {
				dismissNotice();
				void retry();
			}
		: null;
	announce(message);
}
function dismissNotice() {
	$("#notice").hidden = true;
}
function savePreferences() {
	const success = writeLibrary({
		liked: activeUser ? [...liked.values()] : preferences.liked,
		accountUin: activeUser?.uin || preferences.accountUin || "",
		order: session.order,
		queue: session.queue,
		currentId: session.current?.id,
		elapsed: session.elapsed,
		queueSource: session.source,
		artistHistory: recentArtists,
	});
	if (!success && !storageWarning) {
		storageWarning = true;
		notify("本机存储空间不足，当前更改无法保存到下次启动");
	}
}

const transport = new AudioTransport({
	audio,
	provider,
	onState(state) {
		session.playing = state.playing;
		loading = state.loading;
		updatePlayState();
	},
	onProgress(elapsed, duration) {
		if (session.current && Number.isFinite(duration) && duration > 0)
			session.current.duration = duration;
		session.elapsed = elapsed;
		updateTimeline();
		updateLyricPosition();
		if (Date.now() - lastSaved > 5000) {
			lastSaved = Date.now();
			savePreferences();
		}
	},
	onEnded() {
		void advance("next", true);
	},
	onError(error) {
		notify(error.message, () => transport.play());
	},
});

$$("[data-icon]").forEach((element) => {
	element.innerHTML = icon(element.dataset.icon);
});
function updateTimeline() {
	const duration = session.current?.duration || 0;
	$("#seek").max = duration;
	$("#seek").value = session.elapsed;
	$("#seek").style.setProperty(
		"--progress",
		`${duration ? (session.elapsed / duration) * 100 : 0}%`,
	);
	$("#seek").setAttribute(
		"aria-valuetext",
		`${formatTime(session.elapsed)} / ${formatTime(duration)}`,
	);
	$("#elapsed").textContent = formatTime(session.elapsed);
	$("#duration").textContent = formatTime(duration);
	if (navigator.mediaSession && duration > 0 && Number.isFinite(duration)) {
		try {
			navigator.mediaSession.setPositionState({
				duration,
				playbackRate: 1,
				position: Math.min(session.elapsed, duration),
			});
		} catch {
			/* Unsupported media session. */
		}
	}
}
function updatePlayState() {
	const playing = session.playing || transport.desiredPlaying;
	const label = loading ? "取消加载" : playing ? "暂停" : "播放";
	$("#play-toggle").innerHTML =
		`<span class="icon-slot">${icon(playing ? "pause" : "play")}</span>`;
	$("#play-toggle").setAttribute("aria-label", label);
	$("#play-toggle").dataset.tip = `${label} / 空格`;
	$(".player").classList.toggle("is-playing", session.playing);
	$(".player").classList.toggle("is-buffering", loading);
	$("#play-toggle").setAttribute("aria-busy", String(loading));
	document.title = session.current
		? `${session.current.title} · qqmui`
		: "qqmui · qq music ui";
	if (navigator.mediaSession)
		navigator.mediaSession.playbackState = session.playing
			? "playing"
			: "paused";
	window.qqmuiAndroid?.playback(session.current?.title || "qqmui", session.current?.artist || "音乐播放器", session.playing);
}
function updateLikeState() {
	const isLiked = !!session.current && liked.has(session.current.id);
	$("#like-toggle").setAttribute("aria-pressed", String(isLiked));
	$("#like-toggle").setAttribute(
		"aria-label",
		isLiked ? "取消喜欢这首歌" : "喜欢这首歌",
	);
	$("#like-toggle").dataset.tip = isLiked ? "取消喜欢" : "喜欢";
}
function updateMode() {
	const source = session.source;
	const mode = source?.type || "radio";
	const visibleMode = isMobileLayout() ? mobileMode : pageModes[view] || "home";
	$("#mode-icon").innerHTML = icon(modeIcons[visibleMode]);
	$("#mode-toggle").setAttribute(
		"aria-label",
		`切换页面：${modeLabels[visibleMode]}`,
	);
	$("#mode-toggle").dataset.tip = modeLabels[visibleMode];
	$$(".mode-option").forEach((button) =>
		button.setAttribute(
			"aria-checked",
			String(button.dataset.mode === visibleMode),
		),
	);
	positionModeSelection();
	$(".cover-index").textContent =
		`${String(session.index + 1).padStart(2, "0")} — ${{ radio: "FM", liked: "LOVE", artist: "ARTIST", album: "ARTIST" }[mode]}`;
}
function updateArtworkTheme() {
	const image = $("#cover-image");
	const artwork = $("#album-art");
	if (!image.complete || !image.naturalWidth) return;
	const style = getComputedStyle(artwork);
	const filter = style.getPropertyValue("--art-filter").trim() || "none";
	const scale = Number(style.getPropertyValue("--art-scale")) || 1;
	const key = `${image.currentSrc || image.src}|${artwork.dataset.art}`;
	if (key === themedArtwork) return;
	let colors = artworkThemes.get(key);
	if (!colors) {
		try {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 32;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) return;
			context.filter = filter;
			const crop = Math.min(image.naturalWidth, image.naturalHeight) / scale;
			context.drawImage(
				image,
				(image.naturalWidth - crop) / 2,
				(image.naturalHeight - crop) / 2,
				crop,
				crop,
				0,
				0,
				32,
				32,
			);
			const pixels = context.getImageData(0, 0, 32, 32).data;
			const average = (startRow, endRow, shade) => {
				const total = [0, 0, 0];
				let count = 0;
				for (let row = startRow; row < endRow; row++) {
					for (let col = 0; col < 32; col++) {
						const offset = (row * 32 + col) * 4;
						if (pixels[offset + 3] < 128) continue;
						for (let channel = 0; channel < 3; channel++)
							total[channel] += pixels[offset + channel];
						count++;
					}
				}
				return `rgb(${total.map((value) => Math.round((value / Math.max(count, 1)) * shade)).join(" ")})`;
			};
			colors = {
				top: average(0, 13, 0.64),
				base: average(10, 27, 0.69),
				bottom: average(20, 32, 0.58),
			};
			if (artworkThemes.size > 100)
				artworkThemes.delete(artworkThemes.keys().next().value);
			artworkThemes.set(key, colors);
		} catch {
			// Unavailable or cross-origin cover pixels retain the last readable theme.
			return;
		}
	}
	for (const [name, value] of Object.entries(colors))
		document.documentElement.style.setProperty(`--cover-${name}`, value);
	$("meta[name='theme-color']").content = colors.base;
	themedArtwork = key;
}

function updateViews() {
	$("#listening-view").hidden = view !== "player" || !session.current;
	$("#search-view").hidden = view !== "search";
	$("#albums-view").hidden = view !== "albums";
	$("#browse-view").hidden = view !== "browse";
	$("#liked-view").hidden = view !== "liked";
	$("#lyrics-view").hidden = view !== "lyrics";
	$("#empty-view").hidden = view !== "player" || !!session.current;
	if (isMobileLayout()) {
		$("#queue-panel").hidden = view !== "queue";
		$("#queue-toggle").setAttribute("aria-expanded", String(view === "queue"));
	}
	$(".player").classList.toggle("is-searching", view !== "player");
	$(".main-stage").setAttribute("aria-busy", String(sourceLoading));
	$("#empty-message").textContent = sourceLoading
		? "正在寻找好听的音乐…"
		: session.source?.type === "liked"
			? "留一首喜欢的歌给自己"
			: "还没有歌曲，选择一个电台开始听";
	$("#back-to-radio").hidden = sourceLoading;
	for (const selector of [
		"#play-toggle",
		"#previous-track",
		"#next-track",
		"#seek",
		"#like-toggle",
	])
		$(selector).disabled = !session.current;
	$("#album-art").setAttribute("aria-expanded", String(view === "lyrics"));
}
function renderQueue({ scrolling = false } = {}) {
	const list = $("#queue-list");
	const virtual = session.queue.length > 200;
	const start = virtual ? Math.min(Math.max(0, session.queue.length - 60), Math.max(0, Math.floor((list.scrollTop || 0) / 70) - 10)) : 0;
	const end = virtual ? Math.min(session.queue.length, start + 60) : session.queue.length;
	const range = `${start}:${end}`;
	if (scrolling && queueWindow === range) return;
	queueWindow = range;
	const active = list.contains(document.activeElement) ? document.activeElement : null;
	const focused = active?.dataset.index ?? active?.dataset.remove;
	const focusAttribute = active?.dataset.index !== undefined ? "index" : "remove";
	$("#queue-count").textContent = String(session.queue.length).padStart(2, "0");
	$("#queue-list").innerHTML = session.queue.length
		? `${start ? `<div aria-hidden="true" style="height:${start * 70}px"></div>` : ""}${session.queue.slice(start, end)
				.map(
					(track, offset) => {
						const index = start + offset;
						return `
	<div class="queue-item"><button type="button" class="queue-row" data-index="${index}" aria-current="${index === session.index}" aria-label="播放 ${escapeHtml(track.title)}，${escapeHtml(track.artist)}">
	<span class="queue-number">${index === session.index ? '<span class="mini-bars" aria-hidden="true"><i></i><i></i><i></i></span>' : String(index + 1).padStart(2, "0")}</span>
	<span class="queue-cover album-art"><img src="${escapeHtml(artworkUrl(track.coverUrl))}" alt="" width="42" height="42" loading="lazy" /></span>
	<span class="queue-copy"><span class="queue-title">${escapeHtml(track.title)}</span><span class="queue-artist">${escapeHtml(track.artist)}</span></span>
	<span class="queue-time">${formatTime(track.duration)}</span></button><button type="button" class="queue-remove" data-remove="${index}" aria-label="从队列移除 ${escapeHtml(track.title)}">×</button></div>`;
					},
				)
				.join("")}${end < session.queue.length ? `<div aria-hidden="true" style="height:${(session.queue.length - end) * 70}px"></div>` : ""}`
		: '<p class="queue-empty">这里还没有歌曲</p>';
	$("#load-more").hidden = !session.source || session.source.type === "liked" || session.source.hasMore === false;
	$("#load-more").disabled = moreRequest?.queue === session.queue;
	if (focused !== undefined)
		list.querySelector(`[data-${focusAttribute}="${focused}"]`)?.focus({ preventScroll: true });
}
function render() {
	if (session.current) {
		const track = session.current;
		$("#track-title").textContent = track.title;
		$("#track-singer").textContent = track.artist || "";
		$("#track-album").textContent = track.album ? `${track.artist ? " · " : ""}${track.album}` : "";
		$("#album-art").dataset.art = "original";
		const cover = artworkUrl(track.coverUrl);
		if ($("#cover-image").getAttribute("src") !== cover)
			$("#cover-image").src = cover;
		$("#cover-image").alt = track.coverUrl
			? `${track.album || track.title} 封面`
			: "默认封面";
		updateArtworkTheme();
	}
	updateMode();
	updatePlayState();
	updateLikeState();
	updateViews();
	updateTimeline();
	if (!$("#queue-panel").hidden) renderQueue();
}
function updateMediaSession() {
	if (!("mediaSession" in navigator)) return;
	const track = session.current;
	navigator.mediaSession.metadata =
		track && "MediaMetadata" in window
			? new MediaMetadata({
					title: track.title,
					artist: track.artist,
					album: track.album,
					artwork: track.coverUrl
						? [
								{
									src: artworkUrl(track.coverUrl),
									sizes: "500x500",
									type: "image/jpeg",
								},
							]
						: [],
				})
			: null;
}
async function loadCurrent({ autoplay = false, elapsed = 0 } = {}) {
	trackVersion++;
	lyricsId = null;
	dismissNotice();
	session.elapsed = elapsed;
	render();
	updateMediaSession();
	savePreferences();
	if (view === "lyrics") void loadLyrics();
	await transport.select(session.current, { autoplay, elapsed });
	if (autoplay) prefetchTracks();
}
function setView(next) {
	swipeStart = null;
	const mobile = isMobileLayout();
	const previous = mobile && view === "player" ? mobilePage : view;
	// Returning to the mobile player suspends the page, keeping its data and requests.
	const suspend = mobile && next === "player";
	if (previous === "search" && next !== "search" && !suspend) {
		searchVersion++;
		searchAbort?.abort();
		followerObserver?.disconnect();
		clearTimeout(searchTimer);
	}
	if (previous === "albums" && next !== "albums" && !suspend) albumCatalog?.controller.abort();
	if (previous === "browse" && next !== "browse" && !suspend) radioVersion++;
	if (mobile && next !== "player") {
		mobilePage = next;
		mobileMode = pageModes[next] || mobileMode;
	}
	view = next;
	updateMode();
	updateViews();
}
function positionModeSelection() {
	const selected = $('.mode-option[aria-checked="true"]');
	$(".mode-control").dataset.selection = String(!!selected);
	if (!selected) return;
	const offset =
		selected.offsetTop +
		$("#mode-menu").offsetTop -
		$("#mode-toggle").offsetTop;
	$(".mode-control").style.setProperty("--mode-selected-offset", `${offset}px`);
	$(".mode-control").style.setProperty("--mode-selected-x", `${selected.offsetLeft + $("#mode-menu").offsetLeft - $("#mode-toggle").offsetLeft}px`);
}
function prepareModeSelection(button) {
	const toggle = $("#mode-toggle");
	// Re-anchor the shared visual to the clicked row before it slides home.
	// All changes happen within one frame, so there is no duplicate or blank icon.
	toggle.style.transition = "none";
	$$(".mode-option").forEach((option) =>
		option.setAttribute("aria-checked", String(option === button)),
	);
	$("#mode-icon").innerHTML = icon(modeIcons[button.dataset.mode]);
	positionModeSelection();
	void toggle.offsetHeight;
	toggle.style.removeProperty("transition");
}
function setModeMenu(open) {
	modeMenuOpen = open;
	$(".mode-control").dataset.open = String(open);
	$("#mode-menu").inert = !open;
	$("#mode-menu").setAttribute("aria-hidden", String(!open));
	const modal = isMobileLayout() && open;
	$("#mode-backdrop").hidden = !modal;
	$(".player").classList.toggle("is-menu-open", modal);
	if (isMobileLayout())
		for (const selector of [".main-stage", ".player-footer", "#notice"])
			$(selector).inert = modal;
	const toggle = $("#mode-toggle");
	toggle.setAttribute("aria-expanded", String(open));
	// Menu rows own focus while the same visual button continues moving.
	toggle.inert = open;
	toggle.setAttribute("aria-hidden", String(open));
}
function closeModeMenu({ focus = false } = {}) {
	const restore = focus || $("#mode-menu").contains(document.activeElement);
	setModeMenu(false);
	if (restore) $("#mode-toggle").focus();
}
function returnToPlayer() {
	sourceVersion++;
	sourceLoading = false;
	closeModeMenu();
	setView("player");
	$("#mode-toggle").focus();
}
function renderLiked() {
	const tracks = [...liked.values()];
	$("#play-liked").disabled = !tracks.length;
	$("#liked-results").innerHTML = tracks.length
		? tracks.map((track) =>
			`<button type="button" class="artist-row" data-liked-track="${escapeHtml(track.id)}" aria-label="播放 ${escapeHtml(track.title)}，${escapeHtml(track.artist)}"><span class="artist-avatar"><img src="${escapeHtml(artworkUrl(track.coverUrl))}" alt="" loading="lazy" /></span><span class="artist-row-copy"><span class="artist-name">${escapeHtml(track.title)}</span><span class="artist-followers">${escapeHtml(track.artist)}</span></span><span class="icon-slot">${icon("play")}</span></button>`,
		).join("")
		: '<p class="results-message">留一首喜欢的歌给自己</p>';
}
function showLiked() {
	sourceVersion++;
	sourceLoading = false;
	closeModeMenu();
	setView("liked");
	renderLiked();
	$("#mode-toggle").focus();
}
function showSearch() {
	sourceVersion++;
	sourceLoading = false;
	closeModeMenu();
	setView("search");
	$("#search-input").value = "";
	void renderArtists("");
	(isMobileLayout() ? $("#mode-toggle") : $("#search-input")).focus();
}
async function renderArtists(query) {
	const version = ++searchVersion;
	searchAbort?.abort();
	followerObserver?.disconnect();
	searchAbort = new AbortController();
	$("#search-empty").hidden = true;
	if (!query.trim()) {
		displayArtists(recentArtists, version);
		$("#artist-results").setAttribute("aria-busy", "false");
		return;
	}
	$("#artist-results").innerHTML =
		'<p class="results-message">正在寻找声音…</p>';
	$("#artist-results").setAttribute("aria-busy", "true");
	try {
		const results = await provider.searchArtists(query, {
			signal: searchAbort.signal,
		});
		if (version !== searchVersion || !isPageActive("search")) return;
		$("#search-empty").hidden = !!results.length;
		displayArtists(results, version);
		announce(results.length ? `找到 ${results.length} 位歌手` : "没有找到歌手");
	} catch (error) {
		if (version !== searchVersion || !isPageActive("search")) return;
		$("#artist-results").innerHTML =
			'<p class="results-message">搜索暂时不可用</p>';
		notify(error.message, () => renderArtists(query));
	} finally {
		if (version === searchVersion)
			$("#artist-results").setAttribute("aria-busy", "false");
	}
}
function displayArtists(results, version) {
	$("#artist-results").innerHTML = results
		.map(
			(artist) =>
				`<button class="artist-row" type="button" data-artist="${escapeHtml(artist.id)}" aria-label="查看 ${escapeHtml(artist.name)} 的专辑"><span class="artist-avatar" aria-hidden="true"><img src="${escapeHtml(artworkUrl(artist.avatarUrl))}" alt="" loading="lazy" /></span><span class="artist-row-copy"><span class="artist-name">${escapeHtml(artist.name)}</span><span class="artist-followers">${artist.followerCount == null ? "—" : artist.followerCount.toLocaleString("zh-CN")} 人关注</span></span><span class="icon-slot">${icon("play")}</span></button>`,
		)
		.join("");
	$("#artist-results")._artists = results;
	const followerSignal = searchAbort.signal;
	followerObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const row = entry.target;
				followerObserver.unobserve(row);
				void provider
					.getFollowerCount(row.dataset.artist, { signal: followerSignal })
					.then((count) => {
						if (
							version !== searchVersion ||
							!isPageActive("search") ||
							count === null
						)
							return;
						row.querySelector(".artist-followers").textContent =
							`${count.toLocaleString("zh-CN")} 人关注`;
						const artist = results.find((item) => item.id === row.dataset.artist);
						if (artist) artist.followerCount = count;
					})
					.catch(() => {
						/* Follower counts are optional; song selection stays available. */
					});
			}
		},
		{ root: $("#artist-results") },
	);
	$$("[data-artist]").forEach((row) => followerObserver.observe(row));
}
async function showArtistAlbums(artist) {
	sourceVersion++;
	sourceLoading = false;
	albumCatalog?.controller.abort();
	setView("albums");
	recentArtists = rememberArtist(recentArtists, artist);
	savePreferences();
	albumCatalog = { artist, albums: [], page: 0, hasMore: true, pending: false, controller: new AbortController() };
	$("#artist-summary-name").textContent = artist.name;
	$("#artist-summary-image").src = artworkUrl(artist.avatarUrl);
	$("#play-artist").setAttribute("aria-label", `播放 ${artist.name} 的所有歌曲`);
	$("#album-results").innerHTML = "";
	$("#album-results").scrollTop = 0;
	$("#play-artist").focus();
	await loadMoreAlbums();
}
async function loadMoreAlbums() {
	const catalog = albumCatalog;
	if (!catalog || !isPageActive("albums") || catalog.pending || !catalog.hasMore) return;
	catalog.pending = true;
	$("#album-results").setAttribute("aria-busy", "true");
	try {
		const result = await provider.getArtistAlbums(catalog.artist.id, catalog.page + 1, { signal: catalog.controller.signal });
		if (catalog !== albumCatalog || catalog.controller.signal.aborted || !isPageActive("albums")) return;
		const known = new Set(catalog.albums.map((album) => album.id));
		const added = result.albums.filter((album) => !known.has(album.id));
		if (result.albums.length && !added.length && result.hasMore) throw new Error("专辑列表分页未前进，请重试");
		catalog.page++;
		catalog.hasMore = result.hasMore;
		catalog.albums.push(...added);
		$("#album-results").insertAdjacentHTML("beforeend", added.map((album) =>
			`<button type="button" class="artist-row" data-album="${escapeHtml(album.id)}" aria-label="播放 ${escapeHtml(album.name)}"><span class="artist-avatar radio-avatar"><img src="${escapeHtml(artworkUrl(album.coverUrl))}" alt="" loading="lazy" /></span><span class="artist-row-copy"><span class="artist-name">${escapeHtml(album.name)}</span><span class="artist-followers">${escapeHtml(album.publishDate)}</span></span><span class="icon-slot">${icon("play")}</span></button>`).join(""));
	} catch (error) {
		if (catalog === albumCatalog && !catalog.controller.signal.aborted) notify(error.message, loadMoreAlbums);
	} finally {
		catalog.pending = false;
		if (catalog === albumCatalog) $("#album-results").setAttribute("aria-busy", "false");
	}
}
async function showRadio() {
	sourceVersion++;
	sourceLoading = false;
	closeModeMenu();
	setView("browse");
	const version = ++radioVersion;
	$("#mode-toggle").focus();
	$("#radio-results").innerHTML =
		'<p class="results-message">正在连接电台…</p>';
	try {
		const stations = [
			{ id: "new", name: "每日新歌", group: "推荐", coverUrl: "" },
			...(await provider.getRadioStations()),
		];
		if (version !== radioVersion || !isPageActive("browse")) return;
		$("#radio-results")._stations = stations;
		$("#radio-results").innerHTML = stations
			.map(
				(item) =>
					`<button type="button" class="artist-row" data-station="${escapeHtml(item.id)}"><span class="artist-avatar radio-avatar"><img src="${escapeHtml(artworkUrl(item.coverUrl))}" alt="" loading="lazy" /></span><span class="artist-row-copy"><span class="artist-name">${escapeHtml(item.name)}</span><span class="artist-followers">${escapeHtml(item.group)}</span></span><span class="icon-slot">${icon("play")}</span></button>`,
			)
			.join("");
	} catch (error) {
		if (version !== radioVersion || !isPageActive("browse")) return;
		$("#radio-results").innerHTML =
			'<p class="results-message">电台暂时不可用</p>';
		notify(error.message, showRadio);
	}
}
async function switchSource(nextMode, resource, { autoplay = true, trackId } = {}) {
	const version = ++sourceVersion;
	playlistAbort?.abort();
	playlistAbort = new AbortController();
	const signal = playlistAbort.signal;
	closeModeMenu();
	sourceLoading = true;
	updateViews();
	sourceRetry = () => switchSource(nextMode, resource, { autoplay, trackId });
	try {
		let queue, page;
		if (nextMode === "liked") queue = [...liked.values()];
		else if (["artist", "album"].includes(nextMode)) {
			page = await provider[nextMode === "artist" ? "getArtistTrackPage" : "getAlbumTrackPage"](resource.id, 1, { signal });
			queue = page.tracks;
		} else queue = resource.id === "new"
			? await provider.getRecommendedTracks() : await provider.getRadioTracks(resource.id);
		if (version !== sourceVersion) return;
		if (!queue.length)
			throw new Error("暂时没有可用歌曲，请选择其他来源");
		sourceLoading = false;
		sourceRetry = null;
		moreRequest?.controller.abort();
		session.setQueue(queue, {
			autoplay: false, trackId,
			source: { type: nextMode, ...(resource && { resource }), page: 1, ...(page && { hasMore: page.hasMore }) },
		});
		$("#queue-list").scrollTop = 0;
		setView("player");
		void loadCurrent({ autoplay });
		$("#play-toggle").disabled
			? $("#back-to-radio").focus()
			: $("#play-toggle").focus();
		announce(`${modeLabels[nextMode]}，${queue.length} 首歌曲`);
	} catch (error) {
		if (version !== sourceVersion) return;
		notify(error.message, sourceRetry);
	} finally {
		if (version === sourceVersion) {
			sourceLoading = false;
			updateViews();
		}
	}
}
function prefetchTracks() {
	if (["artist", "album"].includes(session.source?.type) && session.source.hasMore !== false &&
		(session.order === "shuffle" || session.queue.length - session.index <= 6)) void loadMore({ quiet: true });
}
async function loadMore({ quiet = false } = {}) {
	const queue = session.queue;
	const source = session.source;
	if (!source || source.type === "liked" || source.hasMore === false) return false;
	if (moreRequest?.queue === queue) return moreRequest.promise;
	const pending = { queue, promise: null, controller: new AbortController() };
	const request = async () => {
		try {
			const paginated = ["artist", "album"].includes(source.type);
			const known = new Set(queue.map((track) => track.id));
			// Duplicate-only pages may occur in the upstream catalogue. Bound each request cycle.
			for (let attempt = 0; attempt < 3; attempt++) {
				const page = paginated
					? await provider[source.type === "artist" ? "getArtistTrackPage" : "getAlbumTrackPage"](
						source.resource.id, source.page + 1, { signal: pending.controller.signal }) : null;
				const tracks = page ? page.tracks : source.resource.id === "new"
					? await provider.getRecommendedTracks() : await provider.getRadioTracks(source.resource.id, 0);
				if (queue !== session.queue) return false;
				const added = tracks.filter((track) => {
					if (known.has(track.id)) return false;
					known.add(track.id);
					return true;
				});
				if (!paginated) added.splice(Math.max(0, 1000 - queue.length));
				if (paginated) {
					source.page++;
					source.hasMore = page.hasMore;
				}
				if (!added.length) {
					if (page?.hasMore) continue;
					savePreferences();
					if (!quiet && !paginated) notify("暂时没有更多歌曲，可以切换其他电台");
					return false;
				}
				session.queue.push(...added);
				savePreferences();
				if (!quiet) announce(`已添加 ${added.length} 首歌曲`);
				return true;
			}
			throw new Error("歌曲列表分页未前进，请重试");
		} catch (error) {
			if (queue === session.queue) notify(error.message, loadMore);
			return false;
		}
	};
	moreRequest = pending;
	pending.promise = request();
	$("#load-more").disabled = true;
	const result = await pending.promise;
	if (moreRequest === pending) moreRequest = null;
	if (!$("#queue-panel").hidden) renderQueue();
	return result;
}
function togglePlay() {
	if (!session.current) return;
	if (transport.desiredPlaying || session.playing) transport.pause();
	else {
		dismissNotice();
		void transport.play();
	}
}
async function advance(direction, automatic = false) {
	if (!session.current) return;
	const version = ++advanceVersion;
	const autoplay = automatic || session.playing || transport.desiredPlaying;
	if (direction === "previous" && session.elapsed > 3) {
		transport.seek(0);
		return;
	}
	if (automatic && session.order === "repeatOne") {
		transport.seek(0);
		void transport.play();
		return;
	}
	if (
		direction === "next" &&
		((session.source?.type === "radio" && automatic && session.order === "repeat") ||
			(["artist", "album"].includes(session.source?.type) && session.source.hasMore !== false)) &&
		session.index === session.queue.length - 1
	) {
		const queue = session.queue;
		const selectedVersion = trackVersion;
		const transportVersion = transport.version;
		await loadMore();
		if (queue !== session.queue || selectedVersion !== trackVersion || version !== advanceVersion || transportVersion !== transport.version) return;
		if (["artist", "album"].includes(session.source?.type) && session.source.hasMore !== false && session.index === session.queue.length - 1) return;
	}
	direction === "next" ? session.next() : session.previous();
	void loadCurrent({ autoplay });
}
function updateOrder() {
	$("#order-toggle").innerHTML =
		`<span class="icon-slot">${icon(session.order)}</span>`;
	$("#order-toggle").setAttribute(
		"aria-label",
		`播放顺序：${orderLabels[session.order]}`,
	);
	$("#order-toggle").dataset.tip = orderLabels[session.order];
	$("#queue-order-icon").innerHTML = icon(session.order);
	$("#queue-order-label").textContent = orderLabels[session.order];
}
function isMobileLayout() {
	return !window.interludeDesktop && mobileLayout.matches;
}
function isPageActive(page) {
	return view === page || (isMobileLayout() && view === "player" && mobilePage === page);
}
function visibleModeOptions() {
	return $$(".mode-option").filter((option) => !isMobileLayout() || option.dataset.mode !== "home");
}
function resumeMobilePage() {
	if (!mobilePage) return;
	setView(mobilePage);
	if (view === "liked") renderLiked();
	else if (view === "queue") renderQueue();
	else if (view === "lyrics") void loadLyrics();
	$("#mode-toggle").focus();
}
function syncQueueLayout() {
	const panel = $("#queue-panel");
	const mobile = isMobileLayout();
	const wasOpen = !panel.hidden;
	closeModeMenu();
	for (const option of $$(".mode-option"))
		if (option.dataset.mode === "home") option.hidden = mobile;
	const parent = mobile ? $(".main-stage") : $(".player");
	if (panel.parentElement !== parent) parent.append(panel);
	panel.classList.toggle("search-view", mobile);
	panel.setAttribute("role", mobile ? "region" : "dialog");
	if (mobile) {
		panel.removeAttribute("aria-modal");
		panel.setAttribute("tabindex", "-1");
		if (view !== "player") {
			mobilePage = view;
			mobileMode = pageModes[view] || mobileMode;
		}
	} else {
		panel.setAttribute("aria-modal", "true");
		panel.removeAttribute("tabindex");
	}
	$("#queue-backdrop").hidden = true;
	for (const selector of [".topbar", ".main-stage", ".player-footer", "#notice"])
		$(selector).inert = false;
	if (wasOpen) {
		if (mobile) {
			setView("queue");
			panel.focus({ preventScroll: true });
		} else {
			if (view === "queue") setView("player");
			openQueue();
		}
	} else { updateMode(); updateViews(); }
}
function openQueue() {
	if (isMobileLayout() && view === "queue") { closeQueue(); return; }
	$("#queue-message").textContent = "";
	closeModeMenu();
	renderQueue();
	if (isMobileLayout()) {
		sourceVersion++;
		sourceLoading = false;
		setView("queue");
		$("#queue-panel").focus({ preventScroll: true });
		return;
	}
	$("#queue-panel").hidden = false;
	$("#queue-backdrop").hidden = false;
	$("#queue-toggle").setAttribute("aria-expanded", "true");
	[".topbar", ".main-stage", ".player-footer"].forEach((selector) => {
		$(selector).inert = true;
	});
	$("#close-queue").focus();
}
function closeQueue() {
	if (view === "queue") returnToPlayer();
	$("#queue-panel").hidden = true;
	$("#queue-backdrop").hidden = true;
	$("#queue-toggle").setAttribute("aria-expanded", "false");
	[".topbar", ".main-stage", ".player-footer"].forEach((selector) => {
		$(selector).inert = false;
	});
	$("#queue-toggle").focus();
}
function removeTrack(index) {
	const current = session.current;
	if (!session.queue[index]) return;
	const autoplay = session.playing || transport.desiredPlaying;
	const removingCurrent = index === session.index;
	session.queue.splice(index, 1);
	session.history = [];
	session.index = removingCurrent
		? Math.min(index, Math.max(0, session.queue.length - 1))
		: Math.max(
				0,
				session.queue.findIndex((track) => track.id === current?.id),
			);
	if (removingCurrent) {
		session.elapsed = 0;
		void loadCurrent({ autoplay });
	}
	render();
	savePreferences();
}
async function loadLyrics() {
	if (!session.current || view !== "lyrics") return;
	if (lyricsId === session.current.id) {
		updateLyricPosition();
		return;
	}
	const id = session.current.id;
	const version = ++lyricsVersion;
	$("#lyrics-title").textContent = session.current.title;
	$("#lyrics-lines").innerHTML = '<p class="results-message">正在加载歌词…</p>';
	lyrics = [];
	activeLyric = -1;
	try {
		const lines = await provider.getLyrics(id);
		if (version !== lyricsVersion || session.current?.id !== id) return;
		lyrics = lines;
		lyricsId = id;
		$("#lyrics-lines").innerHTML = lines.length
			? lines
					.map(
						(line) =>
							`<button class="lyric-line" type="button" data-time="${line.time}" aria-current="false">${escapeHtml(line.text)}</button>`,
					)
					.join("")
			: '<p class="results-message">纯音乐或暂无歌词</p>';
		updateLyricPosition();
	} catch (error) {
		if (version !== lyricsVersion || session.current?.id !== id) return;
		$("#lyrics-lines").innerHTML =
			'<p class="results-message">暂时无法加载歌词</p>';
		notify(error.message, loadLyrics);
	}
}
function updateLyricPosition() {
	if (view !== "lyrics" || !lyrics.length) return;
	let index = lyrics.findLastIndex((line) => line.time <= session.elapsed);
	if (index === activeLyric) return;
	activeLyric = index;
	$$(".lyric-line").forEach((line, i) =>
		line.setAttribute("aria-current", String(i === index)),
	);
	const target = $$(".lyric-line")[index];
	if (target)
		$("#lyrics-lines").scrollTo({
			top:
				target.offsetTop -
				$("#lyrics-lines").offsetTop -
				$("#lyrics-lines").clientHeight / 2 +
				target.clientHeight / 2,
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
}
function showLyrics() {
	if (!session.current) return;
	setView(view === "lyrics" ? "player" : "lyrics");
	if (view === "lyrics") {
		$("#mode-toggle").focus();
		void loadLyrics();
	}
}
$("#mode-toggle").addEventListener("click", () => {
	const opening = !modeMenuOpen;
	setModeMenu(opening);
	if (opening) ($('.mode-option[aria-checked="true"]') || visibleModeOptions()[0]).focus();
});
$("#mode-backdrop").addEventListener("click", () => closeModeMenu({ focus: true }));
$("#mode-menu").addEventListener("click", (event) => {
	const button = event.target.closest("[data-mode]");
	if (!button) return;
	if (button.dataset.mode === "home" && isMobileLayout()) return;
	prepareModeSelection(button);
	if (button.dataset.mode === "home") returnToPlayer();
	else if (button.dataset.mode === "artist") showSearch();
	else if (button.dataset.mode === "radio") void showRadio();
	else showLiked();
});
$("#mode-menu").addEventListener("keydown", (event) => {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const buttons = visibleModeOptions();
	const index = buttons.indexOf(document.activeElement);
	buttons[
		event.key === "Home"
			? 0
			: event.key === "End"
				? buttons.length - 1
				: (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
					buttons.length
	].focus();
});
$("#artist-search").addEventListener("submit", (event) => {
	event.preventDefault();
	clearTimeout(searchTimer);
	void renderArtists($("#search-input").value);
});
function scheduleSearch(event) {
	searchVersion++;
	searchAbort?.abort();
	clearTimeout(searchTimer);
	if (event.isComposing) return;
	if (!$("#search-input").value.trim()) void renderArtists("");
	else searchTimer = setTimeout(() => void renderArtists($("#search-input").value), 280);
}
$("#search-input").addEventListener("input", scheduleSearch);
$("#search-input").addEventListener("compositionend", scheduleSearch);
$("#artist-results").addEventListener("click", (event) => {
	const row = event.target.closest("[data-artist]");
	const artist =
		row &&
		$("#artist-results")._artists?.find(
			(item) => item.id === row.dataset.artist,
		);
	if (artist) void showArtistAlbums(artist);
});
$("#play-artist").addEventListener("click", () => {
	if (albumCatalog) void switchSource("artist", albumCatalog.artist);
});
$("#album-results").addEventListener("click", (event) => {
	const row = event.target.closest("[data-album]");
	const album = albumCatalog?.albums.find((item) => item.id === row?.dataset.album);
	if (album) void switchSource("album", album);
});
$("#album-results").addEventListener("scroll", () => {
	const list = $("#album-results");
	if (list.scrollHeight - list.scrollTop - list.clientHeight < 160) void loadMoreAlbums();
}, { passive: true });
$("#radio-results").addEventListener("click", (event) => {
	const row = event.target.closest("[data-station]");
	const resource =
		row &&
		$("#radio-results")._stations?.find(
			(item) => item.id === row.dataset.station,
		);
	if (resource) void switchSource("radio", resource);
});
$("#play-liked").addEventListener("click", () => void switchSource("liked", null));
$("#liked-results").addEventListener("click", (event) => {
	const row = event.target.closest("[data-liked-track]");
	if (row && liked.has(row.dataset.likedTrack))
		void switchSource("liked", null, { trackId: row.dataset.likedTrack });
});
$("#back-to-radio").addEventListener("click", () => void showRadio());
$("#play-toggle").addEventListener("click", togglePlay);
$("#next-track").addEventListener("click", () => void advance("next"));
$("#previous-track").addEventListener("click", () => void advance("previous"));
$("#seek").addEventListener("input", (event) => {
	transport.seek(event.target.value);
	savePreferences();
});
$("#order-toggle").addEventListener("click", () => {
	session.cycleOrder();
	updateOrder();
	prefetchTracks();
	savePreferences();
	announce(orderLabels[session.order]);
});
$("#like-toggle").addEventListener("click", async () => {
	const current = session.current;
	if (!current || !authReady || favorites.busy.has(current.id)) return;
	const removing = liked.has(current.id);
	const button = $("#like-toggle");
	button.disabled = true;
	button.setAttribute("aria-busy", "true");
	try {
		if (!await favorites.set(current, !removing)) return;
		updateLikeState();
		savePreferences();
		announce(removing ? "已取消喜欢并同步" : "已收藏并同步到 QQ 音乐");
	} catch (error) {
		if (error.code !== "AUTH_REQUIRED") notify(error.message, () => refreshFavorites());
	} finally { button.disabled = false; button.removeAttribute("aria-busy"); }
});
$("#queue-toggle").addEventListener("click", openQueue);
$("#close-queue").addEventListener("click", closeQueue);
$("#queue-backdrop").addEventListener("click", closeQueue);
$("#queue-list").addEventListener("click", (event) => {
	const remove = event.target.closest("[data-remove]");
	if (remove) {
		const index = Number(remove.dataset.remove);
		removeTrack(index);
		$("#queue-list")
			.querySelector(
				`[data-index="${Math.min(index, session.queue.length - 1)}"]`,
			)
			?.focus();
		return;
	}
	const row = event.target.closest("[data-index]");
	if (row && session.select(Number(row.dataset.index))) {
		closeQueue();
		void loadCurrent({ autoplay: true });
	}
});
$("#queue-list").addEventListener("scroll", () => renderQueue({ scrolling: true }), { passive: true });
$("#queue-list").addEventListener("keydown", (event) => {
	if (session.queue.length <= 200) return;
	const row = event.target.closest("[data-index], [data-remove]");
	if (!row) return;
	const index = Number(row.dataset.index ?? row.dataset.remove);
	let next, remove = row.dataset.remove !== undefined;
	if (event.key === "Home") next = 0;
	else if (event.key === "End") next = session.queue.length - 1;
	else if (event.key === "ArrowDown") next = Math.min(session.queue.length - 1, index + 1);
	else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
	else if (event.key === "Tab") {
		if (event.shiftKey && !remove && index > 0) { next = index - 1; remove = true; }
		else if (!event.shiftKey && remove && index < session.queue.length - 1) { next = index + 1; remove = false; }
	}
	if (next === undefined) return;
	event.preventDefault();
	const list = $("#queue-list");
	list.scrollTop = Math.max(0, next * 70 - list.clientHeight / 2);
	renderQueue();
	list.querySelector(`[data-${remove ? "remove" : "index"}="${next}"]`)?.focus();
});
$("#clear-queue").addEventListener("click", () => {
	sourceVersion++;
	sourceLoading = false;
	playlistAbort?.abort();
	moreRequest?.controller.abort();
	session.setQueue([], { autoplay: false });
	void loadCurrent();
	renderQueue();
	(isMobileLayout() ? $("#queue-panel") : $("#close-queue")).focus();
});
$("#load-more").addEventListener("click", () => void loadMore());
$("#album-art").setAttribute("role", "button");
$("#album-art").tabIndex = 0;
$("#album-art").setAttribute("aria-label", "查看歌词");
$("#album-art").setAttribute("aria-controls", "lyrics-view");
$("#album-art").addEventListener("click", showLyrics);
$("#album-art").addEventListener("keydown", (event) => {
	if (["Enter", " "].includes(event.key)) {
		event.preventDefault();
		event.stopPropagation();
		showLyrics();
	}
});
$("#lyrics-lines").addEventListener("click", (event) => {
	const line = event.target.closest("[data-time]");
	if (line) transport.seek(line.dataset.time);
});
$(".player").addEventListener("click", (event) => {
	if (
		view !== "lyrics" ||
		!$("#queue-panel").hidden ||
		event.target.closest(
			"button, input, [role=button], #lyrics-title, .results-message, .mode-control, .window-controls, #notice, #queue-panel, #queue-backdrop",
		)
	) return;
	returnToPlayer();
});
$("#dismiss-notice").addEventListener("click", dismissNotice);
// Pointer hover can stick after a tap; retain focus only for keyboard activation.
$(".click-wheel").addEventListener("click", (event) => {
	if (!isMobileLayout()) return;
	const button = event.target.closest("button");
	if (event.detail > 0 && button === document.activeElement) button.blur();
});
const stage = $(".main-stage");
stage.addEventListener("pointerdown", (event) => {
	swipeStart = null;
	if (!isMobileLayout() || !authReady || modeMenuOpen || (view === "player" && !mobilePage) || event.pointerType === "mouse" || !event.isPrimary ||
		event.target.closest("input, textarea, select, [contenteditable]")) return;
	swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY, view };
});
stage.addEventListener("pointermove", (event) => {
	if (!swipeStart || swipeStart.id !== event.pointerId) return;
	const dx = event.clientX - swipeStart.x, dy = Math.abs(event.clientY - swipeStart.y);
	if (dy > 12 && dy >= Math.abs(dx)) swipeStart = null;
});
stage.addEventListener("pointercancel", () => { swipeStart = null; });
stage.addEventListener("pointerup", (event) => {
	const start = swipeStart;
	swipeStart = null;
	if (!isMobileLayout() || !start || start.id !== event.pointerId || start.view !== view || modeMenuOpen) return;
	const dx = event.clientX - start.x, dy = Math.abs(event.clientY - start.y);
	const returning = view !== "player" && dx >= 72;
	const resuming = view === "player" && dx <= -72;
	if ((!returning && !resuming) || Math.abs(dx) < dy * 2) return;
	suppressClickUntil = Date.now() + 400;
	event.preventDefault();
	if (returning) returnToPlayer();
	else resumeMobilePage();
});
stage.addEventListener("click", (event) => {
	if (!isMobileLayout() || Date.now() >= suppressClickUntil) return;
	event.preventDefault();
	event.stopImmediatePropagation();
}, true);
for (const name of ["pointerdown", "focusin"])
	document.addEventListener(name, (event) => {
		if (!event.target.closest(".mode-control") && modeMenuOpen) closeModeMenu();
	});
document.addEventListener("keydown", (event) => {
	if (!authReady) return;
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		if ($("#queue-panel").hidden && (!isMobileLayout() || !modeMenuOpen)) showSearch();
		return;
	}
	if (event.key === "Escape") {
		if (isMobileLayout() && modeMenuOpen) closeModeMenu({ focus: true });
		else if (!$("#queue-panel").hidden) closeQueue();
		else if (modeMenuOpen) closeModeMenu({ focus: true });
		else if (view !== "player") {
			sourceVersion++;
			sourceLoading = false;
			returnToPlayer();
		}
		return;
	}
	if (modeMenuOpen && isMobileLayout()) {
		if (event.key === "Tab") {
			event.preventDefault();
			const buttons = visibleModeOptions();
			const index = buttons.indexOf(document.activeElement);
			buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
		}
		return;
	}
	if (!$("#queue-panel").hidden && !isMobileLayout()) {
		if (event.key === "Tab") {
			const focusable = [
				...$("#queue-panel").querySelectorAll("button:not(:disabled)"),
			].filter((button) => !button.hidden && button.getClientRects().length);
			const first = focusable[0],
				last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
		return;
	}
	if (
		event.target.closest("input, textarea, select, button, [role=button]") ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey
	)
		return;
	if (event.code === "Space") {
		event.preventDefault();
		togglePlay();
	}
	if (event.code === "ArrowRight") {
		event.preventDefault();
		void advance("next");
	}
	if (event.code === "ArrowLeft") {
		event.preventDefault();
		void advance("previous");
	}
});
if (navigator.mediaSession) {
	for (const [action, handler] of Object.entries({
		play: () => transport.play(),
		pause: () => transport.pause(),
		previoustrack: () => advance("previous"),
		nexttrack: () => advance("next"),
		seekto: (details) => transport.seek(details.seekTime),
		seekbackward: (details) =>
			transport.seek(session.elapsed - (details.seekOffset || 10)),
		seekforward: (details) =>
			transport.seek(session.elapsed + (details.seekOffset || 10)),
	})) {
		try {
			navigator.mediaSession.setActionHandler(action, (...args) => authReady && handler(...args));
		} catch {
			/* OS support varies. */
		}
	}
}
if (window.qqmuiAndroid) {
	document.body.classList.add("android");
	window.addEventListener("qqmui-media", (event) => {
		if (!authReady) return;
		if (event.detail === "play") void transport.play();
		else if (event.detail === "pause") transport.pause();
		else if (event.detail === "next" || event.detail === "previous") void advance(event.detail);
	});
	window.addEventListener("qqmui-back", () => {
		if (modeMenuOpen) closeModeMenu({ focus: true });
		else if (!$("#queue-panel").hidden) closeQueue();
		else if (view !== "player") returnToPlayer();
		else window.qqmuiAndroid.minimize();
	});
}
if (window.interludeDesktop) {
	document.documentElement.classList.add("desktop");
	document.body.classList.add("desktop");
	$(".window-controls").hidden = false;
	$("#minimize-window").addEventListener("click", () =>
		window.interludeDesktop.minimize(),
	);
	$("#close-window").addEventListener("click", () =>
		window.interludeDesktop.close(),
	);
}
mobileLayout.addEventListener("change", syncQueueLayout);
syncQueueLayout();
$("#cover-image").addEventListener("load", () => {
	themedArtwork = null;
	updateArtworkTheme();
});
// Broken artwork is a visual fallback only; it never replaces live song data.
$(".player").addEventListener(
	"error",
	(event) => {
		if (
			event.target instanceof HTMLImageElement &&
			!event.target.src.endsWith("/assets/coast.jpg")
		)
			event.target.src = "./assets/coast.jpg";
	},
	true,
);
const favorites = new FavoriteSync({
	provider, legacy: preferences.liked, legacyAccount: preferences.accountUin,
	onChange(tracks) {
		liked.clear();
		for (const track of tracks) liked.set(track.id, track);
		updateLikeState();
		if (view === "liked") renderLiked();
		if (!$("#queue-panel").hidden) renderQueue();
	},
});
const authentication = new Authentication({
	provider,
	onState({ state, message = "", image }) {
		authReady = state === "ready";
		document.body.classList.toggle("auth-gated", !authReady);
		$("#auth-view").hidden = authReady;
		$("#auth-message").textContent = message;
		$(".auth-caption").hidden = ["checking", "unavailable", "ready"].includes(state);
		$("#auth-qr").hidden = !image;
		if (image) $("#auth-qr").src = image;
		$("#auth-retry").hidden = !["unavailable", "expired", "cancelled", "loginError"].includes(state);
		$("#auth-retry").textContent = state === "unavailable" ? "重新连接" : "刷新二维码";
		$("#auth-retry").onclick = () => state === "unavailable" ? authentication.start() : authentication.login();
		$(".mode-control").inert = !authReady;
		if (authReady) startPlayer();
	},
	async onAuthenticated(user) {
		const previous = activeUser?.uin || preferences.accountUin;
		activeUser = user;
		if (previous && previous !== user.uin) {
			sourceVersion++;
			sourceLoading = false;
			transport.stop();
			session.setQueue([], { autoplay: false });
			preferences.queue = [];
			preferences.currentId = "";
			preferences.elapsed = 0;
			preferences.hasQueue = false;
			preferences.queueSource = { type: "radio", resource: { id: "new", name: "每日新歌" } };
			playerStarted = false;
		}
		favorites.connect(user.uin);
		try { await favorites.sync(); }
		catch (error) { if (error.code === "AUTH_REQUIRED") throw error; notify(`收藏同步失败：${error.message}`, refreshFavorites); }
	},
});
provider.onAuthenticationRequired = () => {
	transport.pause();
	authReady = false;
	favorites.disconnect();
	void authentication.start();
};
let refreshInFlight = null;
let lastRefresh = 0;
function refreshFavorites() {
	if (!authReady) return;
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = (async () => {
		try {
			const status = await provider.getAuthStatus();
			if (!status.authenticated) { provider.onAuthenticationRequired(); return; }
			if (status.user.uin !== activeUser?.uin) { await authentication.start(); return; }
			await favorites.sync();
			savePreferences();
		} catch (error) { if (error.code !== "AUTH_REQUIRED") notify(`收藏同步失败：${error.message}`, refreshFavorites); }
		finally { lastRefresh = Date.now(); refreshInFlight = null; }
	})();
	return refreshInFlight;
}
function startPlayer() {
	if (playerStarted) { render(); return; }
	playerStarted = true;
	session.order = preferences.order;
	session.setQueue(preferences.queue, {
		autoplay: false, trackId: preferences.currentId, source: preferences.queueSource,
	});
	session.seek(preferences.elapsed);
	updateOrder(); render();
	savePreferences();
	if (session.current) void loadCurrent({ elapsed: session.elapsed });
	else if (!preferences.hasQueue && session.source && session.source.type !== "liked")
		void switchSource(session.source.type, session.source.resource, { autoplay: false });
}
window.addEventListener("pagehide", () => { authentication.stop(); savePreferences(); });
window.addEventListener("pageshow", event => { if (event.persisted) void authentication.start(); });
for (const event of ["focus", "online"]) window.addEventListener(event, () => {
	if (authReady && Date.now() - lastRefresh > 30000) void refreshFavorites();
});
setInterval(() => { if (authReady && !document.hidden) void refreshFavorites(); }, 5 * 60 * 1000);
render();
void authentication.start();
