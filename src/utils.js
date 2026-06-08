const ALLOWED_HOSTS = new Set([
  "terabox.app",
  "www.terabox.app",
  "teraboxshare.com",
  "www.teraboxshare.com",
  "terabox.com",
  "www.terabox.com",
  "1024terabox.com",
  "www.1024terabox.com",
  "teraboxlink.com",
  "www.teraboxlink.com",
  "dm.terabox.app",
]);

function loadCookies() {
  let data = null;

  // Priority 1: COOKIE_JSON env var
  const cookieJson = process.env.COOKIE_JSON;
  if (cookieJson) {
    try {
      data = JSON.parse(cookieJson);
    } catch {
      const trimmed = cookieJson.trim();
      if (trimmed) data = { ndus: trimmed };
    }
  }

  // Priority 2: TERABOX_COOKIES_JSON env var
  if (!data) {
    const raw = process.env.TERABOX_COOKIES_JSON;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {}
    }
  }

  if (data && typeof data === "object") {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = String(value);
    }
    return result;
  }

  return {};
}

function isValidShareUrl(u) {
  try {
    const parsed = new URL(u);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return false;
    return parsed.pathname.includes("/s/") || parsed.searchParams.has("surl");
  } catch {
    return false;
  }
}

function extractSurl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("surl")) {
      return parsed.searchParams.get("surl");
    }
    const match = parsed.pathname.match(/\/s\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function formatBytes(bytes, decimals = 2) {
  const b = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!b || isNaN(b)) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

module.exports = { loadCookies, isValidShareUrl, extractSurl, formatBytes };

