const axios = require("axios");
const { loadCookies } = require("./utils");

async function teraFetch(surl) {
  const short_url = surl.startsWith("1") ? surl.substring(1) : surl;

  const cookies = loadCookies();
  const ndus = cookies["ndus"];

  if (!ndus) {
    return { error: "ndus cookie not set. Please configure COOKIE_JSON in environment variables." };
  }

  const cookieString = `ndus=${ndus}`;
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

  // Step 1: Get jsToken
  const firstUrl = `https://dm.terabox.app/sharing/link?surl=${surl}`;

  let jsToken;
  try {
    const response = await axios.get(firstUrl, {
      headers: {
        "User-Agent": userAgent,
        Cookie: cookieString,
      },
      timeout: 10000,
    });

    const match = response.data.match(/fn%28%22(.*?)%22%29/);
    if (!match) {
      return {
        error: "Failed to extract jsToken. Cookie may be expired or Cloudflare blocked the request.",
      };
    }
    jsToken = match[1];
  } catch (err) {
    return { error: `Failed to fetch TeraBox page: ${err.message}` };
  }

  // Step 2: Fetch file list
  try {
    const apiResponse = await axios.get("https://dm.terabox.app/share/list", {
      params: {
        app_id: "250528",
        jsToken,
        site_referer: "https://www.terabox.app/",
        shorturl: short_url,
        root: "1",
      },
      headers: {
        Host: "dm.terabox.app",
        "User-Agent": userAgent,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://dm.terabox.app/sharing/link?surl=${short_url}&clearCache=1`,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://dm.terabox.app",
        Cookie: cookieString,
      },
      timeout: 10000,
    });

    return apiResponse.data;
  } catch (err) {
    return { error: `Failed to fetch file list: ${err.message}` };
  }
}

module.exports = { teraFetch };
