const axios = require("axios");
const cookieManager = require("./cookieManager");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

// Get Cloudflare Worker URL from env
function getCFWorkerUrl() {
  return (process.env.CF_WORKER_URL || "").replace(/\/$/, "");
}

async function teraFetch(surl) {
  const short_url = surl.startsWith("1") ? surl.substring(1) : surl;
  const cfWorker = getCFWorkerUrl();

  const cookieObj = cookieManager.getNext();
  if (!cookieObj) {
    return { error: "No cookies configured. Please set COOKIE_1, COOKIE_2... in environment variables." };
  }

  // If Cloudflare Worker is configured, use it (different IPs)
  // Otherwise fallback to direct requests
  if (cfWorker) {
    return await fetchViaCFWorker(surl, short_url, cookieObj, cfWorker);
  } else {
    return await fetchDirect(surl, short_url, cookieObj);
  }
}

// Fetch via Cloudflare Worker (recommended - different IPs)
async function fetchViaCFWorker(surl, short_url, cookieObj, cfWorker) {
  let jsToken;

  // Step 1: Get jsToken via CF Worker
  try {
    const tokenRes = await axios.get(`${cfWorker}/fetch-token`, {
      params: { surl, cookie: cookieObj.ndus },
      timeout: 15000,
    });

    if (tokenRes.data.error) {
      cookieManager.markFailed(cookieObj.ndus);
      return { error: tokenRes.data.error };
    }

    jsToken = tokenRes.data.jsToken;
    console.log(`[CF] Token fetched via edge: ${tokenRes.data.edge}`);
  } catch (err) {
    cookieManager.markFailed(cookieObj.ndus);
    return { error: `CF Worker token fetch failed: ${err.message}` };
  }

  // Step 2: Get file list via CF Worker
  try {
    const listRes = await axios.get(`${cfWorker}/fetch-list`, {
      params: { surl: short_url, jsToken, cookie: cookieObj.ndus },
      timeout: 15000,
    });

    const data = listRes.data;

    if (data.errno === 31045 || data.error_code === 31045) {
      cookieManager.markFailed(cookieObj.ndus);
      return { error: "Cookie expired or invalid (error 31045)" };
    }

    cookieManager.markSuccess(cookieObj.ndus);
    return data;
  } catch (err) {
    cookieManager.markFailed(cookieObj.ndus);
    return { error: `CF Worker list fetch failed: ${err.message}` };
  }
}

// Direct fetch (fallback if no CF Worker configured)
async function fetchDirect(surl, short_url, cookieObj) {
  const cookieString = `ndus=${cookieObj.ndus}`;

  let jsToken;
  try {
    const response = await axios.get(`https://dm.terabox.app/sharing/link?surl=${surl}`, {
      headers: { "User-Agent": USER_AGENT, Cookie: cookieString },
      timeout: 10000,
    });

    const match = response.data.match(/fn%28%22(.*?)%22%29/);
    if (!match) {
      cookieManager.markFailed(cookieObj.ndus);
      return { error: "Failed to extract jsToken. Cookie may be expired." };
    }
    jsToken = match[1];
  } catch (err) {
    cookieManager.markFailed(cookieObj.ndus);
    return { error: `Failed to fetch TeraBox page: ${err.message}` };
  }

  try {
    const apiResponse = await axios.get("https://dm.terabox.app/share/list", {
      params: { app_id: "250528", jsToken, site_referer: "https://www.terabox.app/", shorturl: short_url, root: "1" },
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
