const axios = require("axios");
const cookieManager = require("./cookieManager");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

/**
 * Get video stream URLs from TeraBox
 * Returns: mp4 direct link + m3u8 HLS playlist
 */
async function getStreamUrls(fsid, shareId, uk, sign, timestamp) {
  const cookieObj = cookieManager.getNext();
  if (!cookieObj) return { error: "No cookies configured" };

  const cookieString = `ndus=${cookieObj.ndus}`;

  try {
    // TeraBox video stream API
    const res = await axios.get("https://www.terabox.app/api/streaming", {
      params: {
        app_id: "250528",
        fsid,
        shareId,
        uk,
        sign,
        timestamp,
        type: "M3U8_AUTO_720",
      },
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://www.terabox.app/",
        Cookie: cookieString,
      },
      timeout: 10000,
    });

    const data = res.data;

    if (data.errno !== 0) {
      cookieManager.markFailed(cookieObj.ndus);
      return { error: `Stream API error: ${data.errmsg || data.errno}` };
    }

    cookieManager.markSuccess(cookieObj.ndus);

    // Extract both stream types
    const streams = data.result || {};
    return {
      m3u8_auto: streams.m3u8_auto_480 || streams.m3u8_auto_360 || null,
      m3u8_720: streams.m3u8_auto_720 || null,
      m3u8_480: streams.m3u8_auto_480 || null,
      m3u8_360: streams.m3u8_auto_360 || null,
      mp4_hd: streams.mp4_hd || null,
      mp4_sd: streams.mp4_sd || null,
    };
  } catch (err) {
    cookieManager.markFailed(cookieObj.ndus);
    return { error: `Stream fetch failed: ${err.message}` };
  }
}

module.exports = { getStreamUrls };
