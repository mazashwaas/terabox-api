const axios = require("axios");
const cookieManager = require("./cookieManager");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

async function teraFetch(surl) {
  const short_url = surl.startsWith("1") ? surl.substring(1) : surl;

  const cookieObj = cookieManager.getNext();
  if (!cookieObj) {
    return { error: "No cookies configured. Please set COOKIE_1, COOKIE_2... in environment variables." };
  }

  const cookieString = `ndus=${cookieObj.ndus}`;

  // Step 1: Get jsToken
  const firstUrl = `https://dm.terabox.app/sharing/link?surl=${surl}`;
  let jsToken;

  try {
    const response = await axios.get(firstUrl, {
      headers: { "User-Agent": USER_AGENT, Cookie: cookieString },
      timeout: 10000,
    });

    const match = response.data.match(/fn%28%22(.*?)%22%29/);
    if (!match) {
      cookieManager.markFailed(cookieObj.ndus);
      return { error: "Failed to extract jsToken. Cookie may be expired or Cloudflare blocked." };
    }

    jsToken = match[1];
  } catch (err) {
    cookieManager.markFailed(cookieObj.ndus);
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
        "User-Agent": USER_AGENT,
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

    const data = apiResponse.data;

    // Check for auth errors
    if (data.errno === 31045 || data.error_code === 31045) {
      cookieManager.markFailed(cookieObj.ndus);
      return { error: "Cookie expired or invalid (error 31045)" };
    }

    cookieManager.markSuccess(cookieObj.ndus);
    return data;

  } catch (err) {
    cookieManager.markFailed(cookieObj.ndus);
    return { error: `Failed to fetch file list: ${err.message}` };
  }
}

module.exports = { teraFetch };
