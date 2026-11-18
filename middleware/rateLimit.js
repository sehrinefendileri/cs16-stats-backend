const rateMap = new Map();

// --------------------------------------------------
// RATE LIMIT
// --------------------------------------------------

function rateLimit(req, limit = 60, windowMs = 60000) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    throw new Error("Geçersiz rate limit ayarları.");
  }

  const ip =
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";

  const now = Date.now();

  const data = rateMap.get(ip);

  // İlk istek veya zaman penceresi dolmuşsa sayacı yenile.
  if (!data || now - data.start >= windowMs) {
    rateMap.set(ip, {
      count: 1,
      start: now,
      windowMs
    });

    return true;
  }

  // Limit aşılmışsa isteği reddet.
  if (data.count >= limit) {
    return false;
  }

  data.count++;

  return true;
}

// --------------------------------------------------
// RATE LIMIT TEMİZLİĞİ
// --------------------------------------------------

function cleanRateMap() {
  const now = Date.now();

  for (const [ip, data] of rateMap.entries()) {
    if (now - data.start >= data.windowMs) {
      rateMap.delete(ip);
    }
  }
}

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = {
  rateLimit,
  cleanRateMap
};