import { icon } from "./icons.js";
import { demoProvider, tracks } from "./data.js";
import { PlayerSession, formatTime, orderLabels } from "./player.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const session = new PlayerSession();
const artworkThemes = new Map();
let themedArtwork = null;
const modeLabels = {
	radio: "推荐电台",
	liked: "喜欢的音乐",
	artist: "歌手电台",
};
const modeIcons = { radio: "radio", liked: "heart", artist: "artist" };
const storageKey = "interlude-preferences-v1";
const knownIds = new Set(tracks.map((track) => track.id));
let mode = "radio";
let selectedArtist = null;
let searching = false;
let searchVersion = 0;
let sourceVersion = 0;
let previousSearchFocus = null;
let lastVolume = 65;
let modeMenuOpen = false;

function readPreferences() {
	try {
		const value = JSON.parse(localStorage.getItem(storageKey) || "null");
		if (!value || typeof value !== "object") return {};
		return value;
	} catch {
		return {};
	}
}

const preferences = readPreferences();
const likedIds = new Set(
	Array.isArray(preferences.liked)
		? preferences.liked.filter((id) => knownIds.has(id))
		: ["travel", "red-bean", "sunny"],
);
let volume = Number.isFinite(preferences.volume)
	? Math.max(0, Math.min(100, preferences.volume))
	: 65;
if (volume > 0) lastVolume = volume;
if (Object.hasOwn(orderLabels, preferences.order))
	session.order = preferences.order;

function savePreferences() {
	try {
		localStorage.setItem(
			storageKey,
			JSON.stringify({ liked: [...likedIds], volume, order: session.order }),
		);
	} catch {
		/* A restricted profile can still use the player for this session. */
	}
}

function announce(message) {
	$("#announcement").textContent = message;
}

function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			],
	);
}

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
}

function updatePlayState() {
	const label = session.playing ? "暂停" : "播放";
	$("#play-toggle").innerHTML =
		`<span class="icon-slot">${icon(session.playing ? "pause" : "play")}</span>`;
	$("#play-toggle").setAttribute("aria-label", label);
	$("#play-toggle").dataset.tip = `${label} / 空格`;
	$(".player").classList.toggle("is-playing", session.playing);
	document.title = session.current
		? `${session.current.title} · 间奏`
		: "间奏 · Interlude";
}

function updateLikeState() {
	const liked = !!session.current && likedIds.has(session.current.id);
	$("#like-toggle").setAttribute("aria-pressed", String(liked));
	$("#like-toggle").setAttribute(
		"aria-label",
		liked ? "取消喜欢这首歌" : "喜欢这首歌",
	);
	$("#like-toggle").dataset.tip = liked ? "取消喜欢" : "喜欢";
}

function updateMode() {
	const visibleMode = searching ? "artist" : mode;
	$("#mode-icon").innerHTML = icon(modeIcons[visibleMode]);
	$("#mode-toggle").setAttribute(
		"aria-label",
		`切换音乐来源：${modeLabels[visibleMode]}`,
	);
	$("#mode-toggle").dataset.tip =
		!searching && mode === "artist" && selectedArtist
			? selectedArtist.name
			: modeLabels[visibleMode];
	$$(".mode-option").forEach((button) =>
		button.setAttribute(
			"aria-checked",
			String(button.dataset.mode === visibleMode),
		),
	);
	$(".cover-index").textContent =
		`${String(session.index + 1).padStart(2, "0")} — ${{ radio: "FM", liked: "LOVE", artist: "ARTIST" }[mode]}`;
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
	$("#listening-view").hidden = searching || !session.current;
	$("#search-view").hidden = !searching;
	$("#empty-view").hidden = searching || !!session.current;
	$(".player").classList.toggle("is-searching", searching);
	[
		"#play-toggle",
		"#previous-track",
		"#next-track",
		"#seek",
		"#like-toggle",
	].forEach((selector) => {
		$(selector).disabled = !session.current;
	});
}

function renderQueue() {
	const focusedIndex = $("#queue-list").contains(document.activeElement)
		? document.activeElement.dataset.index
		: null;
	$("#queue-count").textContent = String(session.queue.length).padStart(2, "0");
	$("#queue-list").innerHTML = session.queue.length
		? session.queue
				.map(
					(track, index) => `
    <button type="button" class="queue-row" data-index="${index}" aria-current="${index === session.index}" aria-label="播放 ${escapeHtml(track.title)}，${escapeHtml(track.artist)}">
      <span class="queue-number">${index === session.index ? '<span class="mini-bars" aria-hidden="true"><i></i><i></i><i></i></span>' : String(index + 1).padStart(2, "0")}</span>
      <span class="queue-cover album-art" data-art="${track.art}"><img src="./assets/coast.jpg" alt="" width="42" height="42" /></span>
      <span class="queue-copy"><span class="queue-title">${escapeHtml(track.title)}</span><span class="queue-artist">${escapeHtml(track.artist)}</span></span>
      <span class="queue-time">${formatTime(track.duration)}</span>
    </button>`,
				)
				.join("")
		: '<p class="queue-empty">这里还没有歌曲</p>';
	if (focusedIndex !== null) {
		$("#queue-list").querySelector(`[data-index="${focusedIndex}"]`)?.focus();
	}
}

function render() {
	if (session.current) {
		const track = session.current;
		$("#track-title").textContent = track.title;
		$("#track-artist").replaceChildren(
			document.createTextNode(track.artist),
			Object.assign(document.createElement("span"), { textContent: "·" }),
			document.createTextNode(track.album),
		);
		$("#album-art").dataset.art = track.art;
		$("#cover-image").alt = `${track.title} 的演示封面：日落时分的海岸`;
		updateArtworkTheme();
	}
	updateMode();
	updatePlayState();
	updateLikeState();
	updateViews();
	updateTimeline();
	if (!$("#queue-panel").hidden) renderQueue();
}

function setModeMenu(open) {
	modeMenuOpen = open;
	$(".mode-control").dataset.open = String(open);
	$("#mode-menu").inert = !open;
	$("#mode-menu").setAttribute("aria-hidden", String(!open));
	$("#mode-toggle").setAttribute("aria-expanded", String(open));
}

function closeModeMenu({ focus = false } = {}) {
	const restoreFocus =
		focus || $("#mode-menu").contains(document.activeElement);
	setModeMenu(false);
	if (restoreFocus) $("#mode-toggle").focus();
}

function closeVolume({ focus = false } = {}) {
	$("#volume-popover").hidden = true;
	$("#volume-toggle").setAttribute("aria-expanded", "false");
	if (focus) $("#volume-toggle").focus();
}

async function showSearch() {
	closeModeMenu();
	closeVolume();
	previousSearchFocus = $("#mode-toggle");
	searching = true;
	updateMode();
	updateViews();
	$("#search-input").value = "";
	await renderArtists("");
	$("#search-input").focus();
}

function closeSearch({ focus = true } = {}) {
	searching = false;
	searchVersion++;
	updateMode();
	updateViews();
	if (focus) previousSearchFocus?.focus();
}

async function renderArtists(query) {
	const version = ++searchVersion;
	const results = await demoProvider.searchArtists(query);
	if (version !== searchVersion || !searching) return;
	$("#search-empty").hidden = results.length > 0;
	$("#artist-results").innerHTML = results
		.map(
			(artist) => `
    <button class="artist-row" type="button" data-artist="${artist.id}" aria-label="播放 ${escapeHtml(artist.name)} 的歌曲">
      <span class="artist-avatar ${artist.color}" aria-hidden="true">${artist.avatarUrl ? `<img src="${escapeHtml(artist.avatarUrl)}" alt="" loading="lazy" />` : escapeHtml(artist.initial)}</span>
      <span class="artist-row-copy"><span class="artist-name">${escapeHtml(artist.name)}</span><span class="artist-followers">${Number.isSafeInteger(artist.followerCount) && artist.followerCount >= 0 ? artist.followerCount.toLocaleString("zh-CN") : "—"} 人关注</span></span>
      <span class="icon-slot">${icon("play")}</span>
    </button>`,
		)
		.join("");
	$("#artist-results").scrollTop = 0;
	$("#artist-results")._artists = results;
	if (query.trim())
		announce(results.length ? `找到 ${results.length} 位歌手` : "没有找到歌手");
}

async function switchMode(nextMode, artist = null) {
	closeModeMenu();
	if (nextMode === "artist" && !artist) {
		sourceVersion++;
		await showSearch();
		return;
	}
	const version = ++sourceVersion;
	const queue =
		nextMode === "liked"
			? await demoProvider.getLikedTracks([...likedIds])
			: nextMode === "artist"
				? await demoProvider.getArtistTracks(artist.id)
				: await demoProvider.getRadioTracks();
	if (version !== sourceVersion) return;
	mode = nextMode;
	selectedArtist = artist;
	closeSearch({ focus: false });
	session.setQueue(queue);
	render();
	announce(
		`${modeLabels[mode]}${artist ? `，${artist.name}` : ""}，${queue.length} 首歌曲`,
	);
	if (artist) $("#play-toggle").focus();
}

function togglePlay() {
	if (!session.current) return;
	session.playing = !session.playing;
	updatePlayState();
	announce(session.playing ? "播放" : "暂停");
}

function advance(direction) {
	const playing = session.playing;
	direction === "next" ? session.next() : session.previous();
	session.playing = playing;
	render();
	if (session.current)
		announce(`${session.current.title}，${session.current.artist}`);
}

function updateVolume() {
	$("#volume").value = volume;
	$("#volume-value").textContent = volume;
	const markup = icon(volume === 0 ? "muted" : "volume");
	$("#volume-toggle .icon-slot").innerHTML = markup;
	$("#mute-toggle .icon-slot").innerHTML = markup;
	$("#mute-toggle").setAttribute(
		"aria-label",
		volume === 0 ? "取消静音" : "静音",
	);
	$("#volume-toggle").dataset.tip = volume === 0 ? "已静音" : `音量 ${volume}%`;
	savePreferences();
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

function openQueue() {
	closeModeMenu();
	closeVolume();
	renderQueue();
	$("#queue-panel").hidden = false;
	$("#queue-backdrop").hidden = false;
	$("#queue-toggle").setAttribute("aria-expanded", "true");
	// Keep focus and screen readers within the modal drawer.
	[".topbar", ".main-stage", ".player-footer"].forEach((selector) => {
		$(selector).inert = true;
	});
	$("#close-queue").focus();
}

function closeQueue() {
	$("#queue-panel").hidden = true;
	$("#queue-backdrop").hidden = true;
	$("#queue-toggle").setAttribute("aria-expanded", "false");
	[".topbar", ".main-stage", ".player-footer"].forEach((selector) => {
		$(selector).inert = false;
	});
	$("#queue-toggle").focus();
}

$("#mode-toggle").addEventListener("click", () => {
	const opening = !modeMenuOpen;
	closeVolume();
	setModeMenu(opening);
	if (opening) $('.mode-option[aria-checked="true"]').focus();
});

$("#mode-menu").addEventListener("click", (event) => {
	const button = event.target.closest("[data-mode]");
	if (button) {
		$("#mode-toggle").focus();
		void switchMode(button.dataset.mode);
	}
});

$("#mode-menu").addEventListener("keydown", (event) => {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const buttons = $$(".mode-option");
	const index = buttons.indexOf(document.activeElement);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? buttons.length - 1
				: (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
					buttons.length;
	buttons[next].focus();
});

$("#volume-toggle").addEventListener("click", () => {
	const opening = $("#volume-popover").hidden;
	closeModeMenu();
	$("#volume-popover").hidden = !opening;
	$("#volume-toggle").setAttribute("aria-expanded", String(opening));
	if (opening) $("#volume").focus();
});
$("#volume").addEventListener("input", (event) => {
	volume = Number(event.target.value);
	if (volume > 0) lastVolume = volume;
	updateVolume();
});
$("#mute-toggle").addEventListener("click", () => {
	volume = volume === 0 ? lastVolume : 0;
	updateVolume();
});
$("#artist-search").addEventListener("submit", (event) => {
	event.preventDefault();
	void renderArtists($("#search-input").value);
});
$("#search-input").addEventListener("input", (event) => {
	if (!event.isComposing) void renderArtists(event.target.value);
});
$("#search-input").addEventListener("compositionend", (event) => {
	void renderArtists(event.target.value);
});
$("#artist-results").addEventListener("click", (event) => {
	const row = event.target.closest("[data-artist]");
	const artist =
		row &&
		$("#artist-results")._artists.find(
			(item) => item.id === row.dataset.artist,
		);
	if (artist) void switchMode("artist", artist);
});
$("#close-search").addEventListener("click", closeSearch);
$("#back-to-radio").addEventListener("click", () => {
	void switchMode("radio");
});
$("#play-toggle").addEventListener("click", togglePlay);
$("#next-track").addEventListener("click", () => advance("next"));
$("#previous-track").addEventListener("click", () => advance("previous"));
$("#seek").addEventListener("input", (event) => {
	session.seek(event.target.value);
	updateTimeline();
});
$("#order-toggle").addEventListener("click", () => {
	session.cycleOrder();
	updateOrder();
	savePreferences();
	announce(orderLabels[session.order]);
});
$("#like-toggle").addEventListener("click", () => {
	const current = session.current;
	if (!current) return;
	likedIds.has(current.id)
		? likedIds.delete(current.id)
		: likedIds.add(current.id);
	savePreferences();
	if (mode === "liked" && !likedIds.has(current.id)) {
		const playing = session.playing;
		const nextIndex = session.index;
		const remaining = session.queue.filter((track) => track.id !== current.id);
		session.setQueue(remaining, {
			autoplay: playing,
			trackId: remaining[Math.min(nextIndex, remaining.length - 1)]?.id,
		});
		render();
		if (!session.current) $("#back-to-radio").focus();
		announce("已移出喜欢的音乐");
	} else {
		updateLikeState();
		$("#like-toggle").classList.remove("bump");
		void $("#like-toggle").offsetWidth;
		$("#like-toggle").classList.add("bump");
		announce(likedIds.has(current.id) ? "已加入喜欢的音乐" : "已取消喜欢");
	}
});
$("#queue-toggle").addEventListener("click", openQueue);
$("#close-queue").addEventListener("click", closeQueue);
$("#queue-backdrop").addEventListener("click", closeQueue);
$("#queue-list").addEventListener("click", (event) => {
	const row = event.target.closest("[data-index]");
	if (!row || !session.select(Number(row.dataset.index))) return;
	render();
	closeQueue();
	announce(`${session.current.title}，${session.current.artist}`);
});

document.addEventListener("pointerdown", (event) => {
	if (!event.target.closest(".mode-control") && modeMenuOpen) closeModeMenu();
	if (!event.target.closest(".volume-control") && !$("#volume-popover").hidden)
		closeVolume();
});

document.addEventListener("focusin", (event) => {
	if (!event.target.closest(".mode-control") && modeMenuOpen) closeModeMenu();
	if (!event.target.closest(".volume-control") && !$("#volume-popover").hidden)
		closeVolume();
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		if (!$("#queue-panel").hidden) closeQueue();
		else if (modeMenuOpen) closeModeMenu({ focus: true });
		else if (!$("#volume-popover").hidden) closeVolume({ focus: true });
		else if (searching) closeSearch();
		return;
	}
	if (!$("#queue-panel").hidden) {
		if (event.key === "Tab") {
			const focusable = [
				...$("#queue-panel").querySelectorAll("button:not(:disabled)"),
			];
			const first = focusable[0];
			const last = focusable.at(-1);
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
		event.target.matches("input, textarea, button") ||
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
		advance("next");
	}
	if (event.code === "ArrowLeft") {
		event.preventDefault();
		advance("previous");
	}
});

if (window.interludeDesktop) {
	document.body.classList.add("desktop");
	$(".window-controls").hidden = false;
	$("#minimize-window").addEventListener("click", () =>
		window.interludeDesktop.minimize(),
	);
	$("#close-window").addEventListener("click", () =>
		window.interludeDesktop.close(),
	);
}

// This is a silent UI prototype. Real HTMLAudioElement playback belongs in a
// transport adapter when the QQ provider and authentication are connected.
let lastTick = performance.now();
setInterval(() => {
	const now = performance.now();
	const seconds = Math.min(2, (now - lastTick) / 1000);
	lastTick = now;
	if (document.hidden) return;
	const changedTrack = session.tick(seconds);
	if (changedTrack) render();
	else if (session.playing) updateTimeline();
}, 250);

$("#cover-image").addEventListener("load", () => {
	artworkThemes.clear();
	themedArtwork = null;
	updateArtworkTheme();
});
session.setQueue(await demoProvider.getRadioTracks(), { autoplay: false });
session.seek(84);
updateOrder();
updateVolume();
render();
