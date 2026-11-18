const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

// --------------------------------------------------
// AYARLAR
// --------------------------------------------------

const ALLOWED_ORIGIN = "https://sehrinefendileri.com";
const CACHE_DURATION = 30000;

let top3Cache = {
  data: null,
  time: 0
};

let top3Request = null;

// --------------------------------------------------
// CORS
// --------------------------------------------------

router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// --------------------------------------------------
// TOP 3 API
// --------------------------------------------------

router.get("/top3", async (req, res) => {
  try {
    // Geçerli önbellek varsa doğrudan döndür.
    if (
      top3Cache.data &&
      Date.now() - top3Cache.time < CACHE_DURATION
    ) {
      return res.json(top3Cache.data);
    }

    // Devam eden sorgu yoksa yeni sorgu başlat.
    if (!top3Request) {
      const request = pool.query(`
        SELECT nick
        FROM (
          SELECT nick,
            (
              ((total_kills - total_deaths) * 1.0) +
              ((total_kills::float / GREATEST(total_deaths, 1)) * 5.0) +
              (hs_percent * 1.5) +
              (total_damage / 1000.0)
            ) AS score
          FROM players
        ) ranked
        ORDER BY score DESC
        LIMIT 3
      `);

      top3Request = request;

      // Yalnızca tamamlanan sorgunun referansını temizle.
      request.finally(() => {
        if (top3Request === request) {
          top3Request = null;
        }
      }).catch(() => {});
    }

    // Mevcut sorguyu bekle.
    const result = await top3Request;

    const data = {
      players: result.rows.map(row => row.nick)
    };

    // Başarılı sonucu önbelleğe al.
    top3Cache = {
      data,
      time: Date.now()
    };

    return res.json(data);

  } catch (err) {
    console.error("Top 3 API hatası:", err.message);

    return res.status(500).json({
      players: [],
      error: "Top 3 verileri alınamadı."
    });
  }
});

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = router;