const express = require("express");
const { teraFetch } = require("./terabox");
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
    version: "1.0.0",
    status: "operational",
    endpoints: {
      "GET /api?url=<terabox_url>": "Get direct download link",
      "GET /health": "Health check",
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

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
    return res.status(400).json({
      status: "error",
      url: targetUrl,
      message: "Invalid TeraBox share URL",
    });
  }

  const surl = extractSurl(targetUrl);
  if (!surl) {
    return res.status(400).json({
      status: "error",
      url: targetUrl,
      message: "Could not extract surl from URL",
    });
  }

  try {
    let data;
    const cached = cache.get(surl);

    if (cached && Date.now() < cached.expiry) {
      data = cached.data;
    } else {
      data = await teraFetch(surl);
      cache.set(surl, { data, expiry: Date.now() + CACHE_DURATION });
    }

    const responseTime = ((Date.now() - startTime) / 1000).toFixed(3) + "s";

    if (data && data.error) {
      return res.status(400).json({
        status: "error",
        url: targetUrl,
        error: data.error,
        response_time: responseTime,
      });
    }

    let filename, size, download, thumbs;

    if (data && data.list && data.list.length > 0) {
      const item = data.list[0];
      filename = item.server_filename;
      size = formatBytes(item.size);
      download = item.dlink;
      thumbs = item.thumbs || null;
    }

    return res.json({
      status: "success",
      response_time: responseTime,
      url: targetUrl,
      ...(filename && { filename }),
      ...(size && { size }),
      ...(download && { download }),
      ...(thumbs && { thumbs }),
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message || String(err),
      url: targetUrl,
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`TeraBox API running on port ${PORT}`);
});
