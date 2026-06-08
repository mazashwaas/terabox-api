/**
 * Cookie Rotation Manager
 * Rotates multiple ndus cookies to distribute requests
 * and avoid TeraBox rate limiting
 */

class CookieManager {
  constructor() {
    this.cookies = [];
    this.currentIndex = 0;
    this.loadFromEnv();
  }

  loadFromEnv() {
    this.cookies = [];

    // Load COOKIE_1, COOKIE_2 ... COOKIE_N format
    let i = 1;
    while (true) {
      const val = process.env[`COOKIE_${i}`];
      if (!val) break;
      try {
        const parsed = JSON.parse(val);
        if (parsed.ndus) {
          this.cookies.push({
            ndus: parsed.ndus,
            label: `COOKIE_${i}`,
            failCount: 0,
            requestCount: 0,
            lastUsed: null,
            active: true,
          });
        }
      } catch {
        // Try raw string
        const trimmed = val.trim();
        if (trimmed) {
          this.cookies.push({
            ndus: trimmed,
            label: `COOKIE_${i}`,
            failCount: 0,
            requestCount: 0,
            lastUsed: null,
            active: true,
          });
        }
      }
      i++;
    }

    // Fallback: single COOKIE_JSON
    if (this.cookies.length === 0) {
      const single = process.env.COOKIE_JSON;
      if (single) {
        try {
          const parsed = JSON.parse(single);
          if (parsed.ndus) {
            this.cookies.push({
              ndus: parsed.ndus,
              label: "COOKIE_JSON",
              failCount: 0,
              requestCount: 0,
              lastUsed: null,
              active: true,
            });
          }
        } catch {}
      }
    }

    console.log(`[CookieManager] Loaded ${this.cookies.length} cookie(s)`);
  }

  // Get next active cookie (round-robin)
  getNext() {
    const active = this.cookies.filter((c) => c.active);
    if (active.length === 0) {
      // All cookies failed — reset fail counts and try again
      console.warn("[CookieManager] All cookies failed! Resetting...");
      this.cookies.forEach((c) => {
        c.failCount = 0;
        c.active = true;
      });
      return this.cookies[0] || null;
    }

    // Round-robin among active cookies
    let attempts = 0;
    while (attempts < this.cookies.length) {
      const cookie = this.cookies[this.currentIndex % this.cookies.length];
      this.currentIndex = (this.currentIndex + 1) % this.cookies.length;
      attempts++;
      if (cookie.active) {
        cookie.requestCount++;
        cookie.lastUsed = new Date().toISOString();
        return cookie;
      }
    }

    return null;
  }

  // Mark cookie as failed
  markFailed(ndus) {
    const cookie = this.cookies.find((c) => c.ndus === ndus);
    if (cookie) {
      cookie.failCount++;
      if (cookie.failCount >= 3) {
        cookie.active = false;
        console.warn(`[CookieManager] Cookie ${cookie.label} disabled after ${cookie.failCount} failures`);
      }
    }
  }

  // Mark cookie as success (reset fail count)
  markSuccess(ndus) {
    const cookie = this.cookies.find((c) => c.ndus === ndus);
    if (cookie) {
      cookie.failCount = 0;
      cookie.active = true;
    }
  }

  // Stats for /health endpoint
  getStats() {
    return {
      total: this.cookies.length,
      active: this.cookies.filter((c) => c.active).length,
      cookies: this.cookies.map((c) => ({
        label: c.label,
        active: c.active,
        requestCount: c.requestCount,
        failCount: c.failCount,
        lastUsed: c.lastUsed,
      })),
    };
  }
}

// Singleton
const cookieManager = new CookieManager();
module.exports = cookieManager;
