const crypto = require("crypto");
const { pool } = require("../config/database");
const fetchPlayers = require("./scraper");
const sendAlertMail = require("./mailer");
const sendTelegramAlert = require("./telegram");
const { cleanRateMap } = require("../middleware/rateLimit");

// --------------------------------------------------
// ORTAM KONTROLÜ
// --------------------------------------------------

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// --------------------------------------------------
// ÖNBELLEK YÖNETİMİ
// --------------------------------------------------

let cache = {};

const CACHE_LIMIT = 50;

function getCache() {
  return cache;
}

function cleanCache() {
  const now = Date.now();

  for (const key in cache) {
    if (now - cache[key].time > 30000) {
      delete cache[key];
    }
  }

  if (Object.keys(cache).length > CACHE_LIMIT) {
    Object.keys(cache).forEach((key) => {
      delete cache[key];
    });
  }

  cleanRateMap();
}

// --------------------------------------------------
// VERİ GÜNCELLEME MOTORU
// --------------------------------------------------

let isRunning = false;

async function fetchAndSave() {
  if (!IS_PRODUCTION) {
    console.log(
      "🛡️ Yerel ortam: Otomatik veri güncelleme devre dışı."
    );

    return {
      success: false,
      skipped: true,
      reason: "Yerel ortamda veri güncelleme devre dışı."
    };
  }

  if (isRunning) {
    return {
      success: false,
      skipped: true,
      reason: "Başka bir güncelleme işlemi devam ediyor."
    };
  }

  isRunning = true;

  let client;
  let transactionStarted = false;
  let clientReleaseError = null;

  try {
    const players = await fetchPlayers();

    if (!players || players.length < 5) {
      throw new Error(
        "Veri çekilemedi veya yetersiz oyuncu verisi alındı."
      );
    }

    const sortedPlayers = [...players].sort((a, b) =>
      a.nick.localeCompare(b.nick)
    );

    const newHash = crypto
      .createHash("md5")
      .update(JSON.stringify(sortedPlayers))
      .digest("hex");

    client = await pool.connect();

    const lastHashRes = await client.query(`
      SELECT id, last_hash
      FROM system_log
      ORDER BY id DESC
      LIMIT 1
    `);

    if (lastHashRes.rows[0]?.last_hash === newHash) {
      return {
        success: true,
        updated: false,
        reason: "Oyuncu verilerinde değişiklik yok."
      };
    }

    await client.query("BEGIN");
    transactionStarted = true;

    for (const p of players) {
      await client.query(
        `
        INSERT INTO players (
          nick,
          total_kills,
          total_deaths,
          total_damage,
          last_kills,
          last_deaths,
          last_damage,
          hs_percent,
          accuracy
        )
        VALUES ($1, $2, $3, $4, $2, $3, $4, $5, $6)

        ON CONFLICT (nick) DO UPDATE SET

          total_kills =
            players.total_kills +
            (
              CASE
                WHEN $2 < players.last_kills THEN $2
                ELSE $2 - players.last_kills
              END
            ),

          total_deaths =
            players.total_deaths +
            (
              CASE
                WHEN $3 < players.last_deaths THEN $3
                ELSE $3 - players.last_deaths
              END
            ),

          total_damage =
            players.total_damage +
            (
              CASE
                WHEN $4 < players.last_damage THEN $4
                ELSE $4 - players.last_damage
              END
            ),

          last_kills = $2,
          last_deaths = $3,
          last_damage = $4,
          hs_percent = $5,
          accuracy = $6,
          updated_at = CURRENT_TIMESTAMP;
        `,
        [
          p.nick,
          p.kills,
          p.deaths,
          p.damage,
          p.hsPercent,
          p.accuracy
        ]
      );
    }

    await client.query(
      `
      INSERT INTO system_log (last_fetch, last_hash)
      VALUES (CURRENT_TIMESTAMP, $1)
      `,
      [newHash]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    Object.keys(cache).forEach((key) => {
      delete cache[key];
    });

    return {
      success: true,
      updated: true,
      playerCount: players.length
    };

  } catch (err) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
        transactionStarted = false;
      } catch (rollbackError) {
        clientReleaseError = rollbackError;

        console.error(
          "❌ Transaction geri alma hatası:",
          rollbackError.message
        );
      }
    }

    console.error("❌ Motor Hatası:", err.message);

    const notificationResults = await Promise.allSettled([
      Promise.resolve().then(() => sendAlertMail(err.message)),
      Promise.resolve().then(() =>
        sendTelegramAlert(`❌ Motor Hatası: ${err.message}`)
      )
    ]);

    notificationResults.forEach((result) => {
      if (result.status === "rejected") {
        console.error(
          "⚠️ Hata bildirimi gönderilemedi:",
          result.reason?.message || result.reason
        );
      }
    });

    return {
      success: false,
      updated: false,
      error: err.message
    };

  } finally {
    try {
      if (client) {
        client.release(clientReleaseError || undefined);
      }
    } finally {
      isRunning = false;
    }
  }
}

// --------------------------------------------------
// OTOMATİK GÜNCELLEME ZAMANLAYICISI
// --------------------------------------------------

let schedulerHandles = null;

function startSchedulers() {
  if (!IS_PRODUCTION) {
    console.log(
      "🛡️ Yerel ortam: Otomatik zamanlayıcılar devre dışı."
    );

    return {
      stop: () => {}
    };
  }

  if (schedulerHandles) {
    return schedulerHandles;
  }

  const fetchInterval = setInterval(() => {
    fetchAndSave().catch((err) => {
      console.error(
        "❌ Otomatik güncelleme zamanlayıcısı hatası:",
        err.message
      );
    });
  }, 180000);

  const cleanInterval = setInterval(() => {
    try {
      cleanCache();
    } catch (err) {
      console.error(
        "❌ Önbellek temizleme hatası:",
        err.message
      );
    }
  }, 60000);

  schedulerHandles = {
    stop: () => {
      clearInterval(fetchInterval);
      clearInterval(cleanInterval);

      schedulerHandles = null;
    }
  };

  return schedulerHandles;
}

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = {
  fetchAndSave,
  cleanCache,
  startSchedulers,
  getCache
};