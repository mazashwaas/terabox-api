const express = require("express");
const axios = require("axios");
const { teraFetch } = require("./terabox");
const cookieManager = require("./cookieManager");
const { isValidShareUrl, extractSurl, formatBytes } = require("./utils");

const app = express();
const PORT = process.env.PORT || 5000;

// In-memory cache (2 hours)
const cache = new Map();
const CACHE_DURATION = 2 * 60 * 60 * 1000;

// CORS Middleware
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "TeraBox Downloader API",
    version: "3.0.0",
    status: "operational",
    endpoints: {
      "GET /api?url=<terabox_url>": "Get file info + download link",
      "GET /download?url=<terabox_url>": "Directly stream/download the file",
      "GET /health": "Health check + cookie stats",
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check with cookie stats
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cache_size: cache.size,
    cookies: cookieManager.getStats(),
  });
});

// Helper: fetch and cache terabox data
async function getData(surl) {
  const cached = cache.get(surl);
  if (cached && Date.now() < cached.expiry) return cached.data;
  const data = await teraFetch(surl);
  if (!data.error) {
    cache.set(surl, { data, expiry: Date.now() + CACHE_DURATION });
  }
  return data;
}

// Main API endpoint
app.get("/api", async (req, res) => {
  const startTime = Date.now();
  const rawUrl = req.query.url;

  if (!rawUrl || !rawUrl.trim()) {
    return res.status(400).json({
      status: "error",
      message: "Missing required parameter: url",
      example: "/api?url=https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g",
    });
  }

  const targetUrl = rawUrl.trim();

  if (!targetUrl.startsWith("http") || !isValidShareUrl(targetUrl)) {
    return res.status(400).json({ status: "error", url: targetUrl, message: "Invalid TeraBox share URL" });
  }

  const surl = extractSurl(targetUrl);
  if (!surl) {
    return res.status(400).json({ status: "error", url: targetUrl, message: "Could not extract surl from URL" });
  }

  try {
    const data = await getData(surl);
    const responseTime = ((Date.now() - startTime) / 1000).toFixed(3) + "s";

    if (data && data.error) {
      return res.status(400).json({ status: "error", url: targetUrl, error: data.error, response_time: responseTime });
    }

    let filename, size, download, thumbs;
    if (data && data.list && data.list.length > 0) {
      const item = data.list[0];
      filename = item.server_filename;
      size = formatBytes(item.size);
      download = item.dlink;
      thumbs = item.thumbs || null;
    }

    const proxyDownload = `${req.protocol}://${req.get("host")}/download?url=${encodeURIComponent(targetUrl)}`;

    return res.json({
      status: "success",
      response_time: responseTime,
      url: targetUrl,
      ...(filename && { filename }),
      ...(size && { size }),
      ...(download && { download }),
      proxy_download: proxyDownload,
      ...(thumbs && { thumbs }),
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message || String(err), url: targetUrl });
  }
});

// Download proxy endpoint
app.get("/download", async (req, res) => {
  const rawUrl = req.query.url;

  if (!rawUrl || !rawUrl.trim()) {
    return res.status(400).json({ status: "error", message: "Missing url parameter" });
  }

  const targetUrl = rawUrl.trim();

  if (!isValidShareUrl(targetUrl)) {
    return res.status(400).json({ status: "error", message: "Invalid TeraBox share URL" });
  }

  const surl = extractSurl(targetUrl);
  if (!surl) {
    return res.status(400).json({ status: "error", message: "Could not extract surl" });
  }

  try {
    const data = await getData(surl);

    if (!data || data.error || !data.list || data.list.length === 0) {
      return res.status(400).json({ status: "error", message: data?.error || "Could not get file info" });
    }

    const item = data.list[0];
    const dlink = item.dlink;
    const filename = item.server_filename || "download";

    if (!dlink) {
      return res.status(400).json({ status: "error", message: "No download link found" });
    }

    // Use a fresh cookie for download
    const cookieObj = cookieManager.getNext();
    const cookieString = cookieObj ? `ndus=${cookieObj.ndus}` : "";

    const fileResponse = await axios({
      method: "GET",
      url: dlink,
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36",
        "Referer": "https://www.terabox.app/",
        ...(cookieString && { Cookie: cookieString }),
      },
      maxRedirects: 5,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Content-Type", fileResponse.headers["content-type"] || "application/octet-stream");
    if (fileResponse.headers["content-length"]) {
      res.setHeader("Content-Length", fileResponse.headers["content-length"]);
    }

    fileResponse.data.pipe(res);
    fileResponse.data.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ status: "error", message: "Stream failed" });
    });

  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ status: "error", message: err.message || "Download failed" });
    }
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`TeraBox API v3.0 running on port ${PORT}`);
});
