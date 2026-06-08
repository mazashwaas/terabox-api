# ☁️ TeraBox Downloader API (Node.js + Express)

Direct download link generator for TeraBox share URLs.

## 🚀 Quick Start

### Local
```bash
npm install
cp .env.example .env   # Fill in your ndus cookie
npm start
```

### Dev mode (auto-reload)
```bash
npm run dev
```

---

## 🔌 API

### `GET /api?url=<terabox_url>`

**Example:**
```
GET /api?url=https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g
```

**Response:**
```json
{
  "status": "success",
  "response_time": "1.234s",
  "url": "https://terabox.app/s/...",
  "filename": "video.mp4",
  "size": "500.00 MB",
  "download": "https://d.terabox.app/...",
  "thumbs": "https://thumb.terabox.app/..."
}
```

### `GET /health`
Returns server uptime status.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `COOKIE_JSON` | ✅ Yes | `{"ndus": "your_cookie"}` |
| `PORT` | No | Default: `5000` |

### How to get `ndus` cookie:
1. Login to [terabox.app](https://terabox.app)
2. Open DevTools → Application → Cookies
3. Copy the `ndus` value

---

## 🚢 Deploy

### Railway
1. Push code to GitHub
2. New Project → Deploy from GitHub repo
3. Add env variable: `COOKIE_JSON={"ndus": "your_value"}`
4. Done ✅

### Render
1. New Web Service → Connect GitHub repo
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Add env variable: `COOKIE_JSON={"ndus": "your_value"}`
5. Done ✅

### Docker
```bash
docker build -t terabox-api .
docker run -p 5000:5000 -e COOKIE_JSON='{"ndus":"your_value"}' terabox-api
```
