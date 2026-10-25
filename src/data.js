// The renderer consumes this normalized provider, independent of QQ's response shapes.
// These records demonstrate the UI; artwork and durations are illustrative.
export const tracks = [
	{
		id: "summer",
		title: "夏日漱石",
		artist: "橘子海",
		artistId: "orange-ocean",
		album: "浪潮",
		duration: 192,
		art: "coast",
	},
	{
		id: "sunset",
		title: "落日飞车",
		artist: "落日飞车",
		artistId: "sunset-rollercoaster",
		album: "Cassa Nova",
		duration: 258,
		art: "dusk",
	},
	{
		id: "travel",
		title: "旅行的意义",
		artist: "陈绮贞",
		artistId: "cheer",
		album: "华丽的冒险",
		duration: 256,
		art: "forest",
	},
	{
		id: "red-bean",
		title: "红豆",
		artist: "王菲",
		artistId: "faye",
		album: "唱游",
		duration: 259,
		art: "rose",
	},
	{
		id: "sunny",
		title: "晴天",
		artist: "周杰伦",
		artistId: "jay",
		album: "叶惠美",
		duration: 269,
		art: "sky",
	},
	{
		id: "bicycle",
		title: "单车",
		artist: "陈奕迅",
		artistId: "eason",
		album: "Shall We Dance? Shall We Talk!",
		duration: 209,
		art: "night",
	},
	{
		id: "orange",
		title: "有暖气",
		artist: "橘子海",
		artistId: "orange-ocean",
		album: "浪潮",
		duration: 241,
		art: "dusk",
	},
	{
		id: "gold",
		title: "My Jinji",
		artist: "落日飞车",
		artistId: "sunset-rollercoaster",
		album: "Jinji Kikko",
		duration: 401,
		art: "rose",
	},
	{
		id: "flower",
		title: "花的姿态",
		artist: "陈绮贞",
		artistId: "cheer",
		album: "华丽的冒险",
		duration: 290,
		art: "forest",
	},
	{
		id: "dream",
		title: "梦中人",
		artist: "王菲",
		artistId: "faye",
		album: "胡思乱想",
		duration: 263,
		art: "sky",
	},
	{
		id: "quiet",
		title: "安静",
		artist: "周杰伦",
		artistId: "jay",
		album: "范特西",
		duration: 334,
		art: "night",
	},
	{
		id: "long",
		title: "好久不见",
		artist: "陈奕迅",
		artistId: "eason",
		album: "认了吧",
		duration: 250,
		art: "forest",
	},
];

// QQ follower counts and portraits are unknown in the offline demo.
export const artists = [
	{
		id: "orange-ocean",
		name: "橘子海",
		en: "orange ocean juzihai",
		initial: "橘",
		avatarUrl: null,
		followerCount: null,
		color: "orange",
	},
	{
		id: "cheer",
		name: "陈绮贞",
		en: "cheer chen chenqizhen",
		initial: "陈",
		avatarUrl: null,
		followerCount: null,
		color: "green",
	},
	{
		id: "sunset-rollercoaster",
		name: "落日飞车",
		en: "sunset rollercoaster luorifeiche",
		initial: "落",
		avatarUrl: null,
		followerCount: null,
		color: "rose",
	},
	{
		id: "faye",
		name: "王菲",
		en: "faye wong wangfei",
		initial: "王",
		avatarUrl: null,
		followerCount: null,
		color: "blue",
	},
	{
		id: "jay",
		name: "周杰伦",
		en: "jay chou zhoujielun",
		initial: "周",
		avatarUrl: null,
		followerCount: null,
		color: "green",
	},
	{
		id: "eason",
		name: "陈奕迅",
		en: "eason chan chenyixun",
		initial: "陈",
		avatarUrl: null,
		followerCount: null,
		color: "orange",
	},
];

export function searchArtists(query = "") {
	const term = query.trim().toLocaleLowerCase();
	if (!term) return artists.slice(0, 4);
	return artists.filter((artist) =>
		`${artist.name} ${artist.en}`.toLocaleLowerCase().includes(term),
	);
}

export const demoProvider = {
	searchArtists: async (query) => searchArtists(query),
	getRadioTracks: async () => tracks.slice(0, 6),
	getArtistTracks: async (artistId) =>
		tracks.filter((track) => track.artistId === artistId),
	getLikedTracks: async (ids) =>
		tracks.filter((track) => ids.includes(track.id)),
};
