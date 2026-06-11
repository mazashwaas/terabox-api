const express = require("express");
const axios = require("axios");
const { teraFetch } = require("./terabox");
const { getStreamUrls } = require("./stream");
const cookieManager = require("./cookieManager");
const { isValidShareUrl, extractSurl, formatBytes } = require("./utils");

const app = express();
const PORT = process.env.PORT || 5000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";

// Cache
const cache = new Map();
const streamCache = new Map();
const CACHE_DURATION = 2 * 60 * 60 * 1000;

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Root
app.get("/", (req, res) => {
  res.json({
    name: "TeraBox Downloader API",
    version: "4.0.0",
    status: "operational",
    endpoints: {
      "GET /api?url=": "File info + download + stream links",
      "GET /stream?url=": "Only stream URLs (MP4 + HLS/M3U8)",
      "GET /download?url=": "Proxy download file",
      "GET /health": "Health check + cookie stats",
    },
    timestamp: new Date().toISOString(),
  });
});

// Health
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cache_size: cache.size,
    stream_cache_size: streamCache.size,
    cookies: cookieManager.getStats(),
  });
});

// Helper: get + cache main data
async function getData(surl) {
  const cached = cache.get(surl);
  if (cached && Date.now() < cached.expiry) return cached.data;
  const data = await teraFetch(surl);
  if (!data.error) cache.set(surl, { data, expiry: Date.now() + CACHE_DURATION });
  return data;
}

// Helper: extract file meta
function extractFileMeta(data) {
  if (!data || !data.list || data.list.length === 0) return null;
  const item = data.list[0];

  // fid format: uk-appid-fsid  e.g. "81366184102199-250528-187071833914309"
  let ukFromFid = null, fsidFromFid = null;
  const fid = item.path_fid || item.fid || null;
  if (fid) {
    const parts = String(fid).split("-");
    if (parts.length >= 3) {
      ukFromFid = parts[0];
      fsidFromFid = parts[2];
    }
  }

  // Also try to parse from dlink fid param
  let ukFromDlink = null, fsidFromDlink = null;
  if (item.dlink) {
    try {
      const dlUrl = new URL(item.dlink);
      const fidParam = dlUrl.searchParams.get("fid");
      if (fidParam) {
        const parts = fidParam.split("-");
        if (parts.length >= 3) {
          ukFromDlink = parts[0];
          fsidFromDlink = parts[2];
        }
      }
    } catch {}
  }

  const uk = data.uk || item.uk || ukFromFid || ukFromDlink || null;
  const fsid = item.fs_id || fsidFromFid || fsidFromDlink || null;
  const shareId = data.shareid || item.shareid || null;

  return {
    filename: item.server_filename,
    size: formatBytes(item.size),
    fsid,
    uk,
    shareId,
    sign: data.sign || null,
    timestamp: data.timestamp || null,
    dlink: item.dlink,
    thumbs: item.thumbs || null,
    isVideo: item.server_filename?.match(/\.(mp4|mkv|avi|mov|flv|webm|m4v)$/i) ? true : false,
  };
}

// Helper: get stream with cache
async function getStreams(meta) {
  if (!meta.isVideo || !meta.dlink) return null;
  const cacheKey = `stream_${meta.fsid}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.data;
  // TeraBox streaming API restricted for public shares
  // dlink IS the mp4 — use proxy_download as stream
  const streams = { mp4_hd: meta.dlink, mp4_sd: null, m3u8_720: null, m3u8_480: null, m3u8_360: null, m3u8_auto: null };
  streamCache.set(cacheKey, { data: streams, expiry: Date.now() + CACHE_DURATION });
  return streams;
}

// /api — full info
app.get("/api", async (req, res) => {
  const startTime = Date.now();
  const rawUrl = req.query.url;
  if (!rawUrl?.trim()) return res.status(400).json({ status: "error", message: "Missing url parameter" });

  const targetUrl = rawUrl.trim();
  if (!isValidShareUrl(targetUrl)) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const surl = extractSurl(targetUrl);
  if (!surl) return res.status(400).json({ status: "error", message: "Could not extract surl" });

  try {
    const data = await getData(surl);
    const responseTime = ((Date.now() - startTime) / 1000).toFixed(3) + "s";
    if (data?.error) return res.status(400).json({ status: "error", error: data.error, response_time: responseTime });

    const meta = extractFileMeta(data);
    if (!meta) return res.status(400).json({ status: "error", message: "Could not parse file info" });

    const host = `${req.protocol}://${req.get("host")}`;
    const encodedUrl = encodeURIComponent(targetUrl);
    const streamUrls = await getStreams(meta);

    return res.json({
      status: "success",
      response_time: responseTime,
      url: targetUrl,
      filename: meta.filename,
      size: meta.size,
      is_video: meta.isVideo,
      download: meta.dlink,
      proxy_download: `${host}/download?url=${encodedUrl}`,
      ...(streamUrls && {
        stream: {
          mp4_hd: streamUrls.mp4_hd || null,
          mp4_sd: streamUrls.mp4_sd || null,
          hls_720p: streamUrls.m3u8_720 || null,
          hls_480p: streamUrls.m3u8_480 || null,
          hls_360p: streamUrls.m3u8_360 || null,
          hls_auto: streamUrls.m3u8_auto || null,
          proxy_stream: `${host}/stream?url=${encodedUrl}`,
        },
      }),
      thumbs: meta.thumbs,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
});

// /stream — only stream URLs
app.get("/stream", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl?.trim()) return res.status(400).json({ status: "error", message: "Missing url parameter" });

  const targetUrl = rawUrl.trim();
  if (!isValidShareUrl(targetUrl)) return res.status(400).json({ status: "error", message: "Invalid TeraBox URL" });

  const surl = extractSurl(targetUrl);
  if (!surl) return res.status(400).json({ status: "error", message: "Could not extract surl" });

  try {
    const data = await getData(surl);
    if (data?.error) return res.status(400).json({ status: "error", error: data.error });

    const meta = extractFileMeta(data);
    if (!meta) return res.status(400).json({ status: "error", message: "Could not parse file info" });
    if (!meta.isVideo) return res.status(400).json({ status: "error", message: "File is not a video" });
    if (!meta.fsid) return res.status(400).json({ status: "error", message: "Missing fsid param", debug: { fsid: meta.fsid, uk: meta.uk, shareId: meta.shareId } });

    const streams = await getStreams(meta);
    if (!streams || streams.error) {
      return res.status(400).json({ 
        status: "error", 
        message: streams?.error || "Could not get stream URLs",
        debug: { fsid: meta.fsid, uk: meta.uk, shareId: meta.shareId }
      });
    }

    return res.json({
      status: "success",
      filename: meta.filename,
      size: meta.size,
      stream: {
        mp4_hd: streams.mp4_hd || null,
        mp4_sd: streams.mp4_sd || null,
        hls_720p: streams.m3u8_720 || null,
        hls_480p: streams.m3u8_480 || null,
        hls_360p: streams.m3u8_360 || null,
        hls_auto: streams.m3u8_auto || null,
      },
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
});

// /download — Range-aware proxy stream (supports seeking)
app.get("/download", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl?.trim()) return res.status(400).json({ status: "error", message: "Missing url parameter" });

  const targetUrl = rawUrl.trim();
  if (!isValidShareUrl(targetUrl)) return res.status(400).json({ status: "error", message: "Invalid URL" });

  const surl = extractSurl(targetUrl);
  if (!surl) return res.status(400).json({ status: "error", message: "Could not extract surl" });

  try {
    const data = await getData(surl);
    if (!data || data.error || !data.list?.length) {
      return res.status(400).json({ status: "error", message: data?.error || "Could not get file info" });
    }

    const item = data.list[0];
    const dlink = item.dlink;
    const filename = item.server_filename || "download";

    if (!dlink) return res.status(400).json({ status: "error", message: "No download link" });

    const cookieObj = cookieManager.getNext();
    const cookieString = cookieObj ? `ndus=${cookieObj.ndus}` : "";
    const rangeHeader = req.headers["range"];
    const isDownload = req.query.dl === "1";

    // ── STEP 1: Try HEAD request to check if dlink is directly accessible ──
    // If TeraBox serves it without cookie (some regions/links do), redirect directly
    // This skips Render bandwidth entirely = much faster streaming
    if (!isDownload && !rangeHeader) {
      try {
        const headRes = await axios.head(dlink, {
          timeout: 5000,
          maxRedirects: 5,
          headers: {
            "User-Agent": USER_AGENT,
            "Referer": "https://www.terabox.app/",
            ...(cookieString && { Cookie: cookieString }),
          },
          validateStatus: (s) => s < 400,
        });

        // Get final URL after redirects
        const finalUrl = headRes.request?.res?.responseUrl || headRes.config?.url || dlink;
        const ct = headRes.headers["content-type"] || "";

        if (ct.includes("video") || ct.includes("octet-stream")) {
          // Direct redirect — browser fetches from TeraBox/CDN directly
          res.setHeader("Access-Control-Allow-Origin", "*");
          return res.redirect(302, finalUrl);
        }
      } catch {
        // HEAD failed — fall through to proxy
      }
    }

    // ── STEP 2: Proxy stream (fallback) ──
    const requestHeaders = {
      "User-Agent": USER_AGENT,
      "Referer": "https://www.terabox.app/",
      ...(cookieString && { Cookie: cookieString }),
      ...(rangeHeader && { Range: rangeHeader }),
    };

    const fileResponse = await axios({
      method: "GET",
      url: dlink,
      responseType: "stream",
      timeout: 30000,
      headers: requestHeaders,
      maxRedirects: 5,
    });

    const contentType = fileResponse.headers["content-type"] || "video/mp4";
    const contentLength = fileResponse.headers["content-length"];
    const contentRange = fileResponse.headers["content-range"];

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (isDownload) {
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    } else {
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
    }

    res.status(rangeHeader ? 206 : 200);
    fileResponse.data.pipe(res);

    fileResponse.data.on("error", (err) => {
      console.error("Stream error:", err.message);
      if (!res.headersSent) res.status(500).json({ status: "error", message: "Stream failed" });
    });

    req.on("close", () => fileResponse.data.destroy());

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ status: "error", message: err.message });
  }
});


// 404
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

app.listen(PORT, () => console.log(`TeraBox API v4.0 running on port ${PORT}`));
