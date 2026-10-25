const paths = {
	radio:
		'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="m6 7 11-4M7 12h.01M7 16h.01M12 12h5M12 16h5"/>',
	heart:
		'<path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 6l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.3a5.5 5.5 0 0 0 0-7.8Z"/>',
	artist:
		'<circle cx="12" cy="8" r="4"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/>',
	close: '<path d="m6 6 12 12M6 18 18 6"/>',
	minus: '<path d="M5 12h14"/>',
	volume:
		'<path d="m11 4-5 4H3v8h3l5 4V4Z"/><path d="M15.5 8a6 6 0 0 1 0 8M18.5 5a10 10 0 0 1 0 14"/>',
	muted: '<path d="m11 4-5 4H3v8h3l5 4V4ZM17 9l5 6M17 15l5-6"/>',
	search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
	arrowRight: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
	repeat:
		'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
	repeatOne:
		'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3m8-8 1-1v6"/>',
	shuffle:
		'<path d="m18 3 3 3-3 3M18 15l3 3-3 3M3 6h3c5 0 7 12 12 12h3M3 18h3c1.5 0 3-1.2 4.3-3M13.7 9C15 7.2 16.5 6 18 6h3"/>',
	previous:
		'<path d="M5 5v14"/><path d="m19 5-10 7 10 7V5Z" fill="currentColor" stroke-width="1"/>',
	next: '<path d="M19 5v14"/><path d="m5 5 10 7-10 7V5Z" fill="currentColor" stroke-width="1"/>',
	play: '<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="currentColor" stroke-width="1.5"/>',
	pause: '<path d="M8 5v14M16 5v14" stroke-width="3.5"/>',
	queue:
		'<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="1" fill="currentColor"/>',
	check: '<path d="m5 12 4 4L19 6"/>',
};

export function icon(name) {
	return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.radio}</svg>`;
}
