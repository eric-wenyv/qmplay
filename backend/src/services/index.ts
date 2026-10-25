// Only dependencies of the endpoints used by qqmui belong in this service bundle.
import getHotKey from './search/getHotKey';
import getSmartbox from './search/getSmartbox';
import getSingerStarNum from './singers/getSingerStarNum';
import getRadioLists from './radio/getRadioLists';
import getRadioTracks from './radio/getRadioTracks';
import getLyric from './music/getLyric';
import UCommon from './UCommon/UCommon';

export default {
  getHotKey,
  getSmartbox,
  getSingerStarNum,
  getRadioLists,
  getRadioTracks,
  getLyric,
  UCommon,
};
