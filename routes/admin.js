const express = require("express");
const { pool } = require("../config/database");
const { fetchAndSave } = require("../services/scheduler");
const sendTelegramAlert = require("../services/telegram");
const verifyAdmin = require("../middleware/auth");

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// --------------------------------------------------
// YÖNETİCİ SAYFALARINDA ÖNBELLEKLEMEYİ ENGELLE
// --------------------------------------------------

router.use((req, res, next) => {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// --------------------------------------------------
// HTML GÜVENLİK YARDIMCISI
// --------------------------------------------------

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[char];
  });
}

// --------------------------------------------------
// YÖNETİCİ SAYFA TASARIMI
// --------------------------------------------------

// subMessage yalnızca bu dosyada oluşturulan,
// güvenilir ve gerektiğinde önceden kaçış uygulanmış HTML içerir.
const adminLayout = (title, message, subMessage) => `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  <link rel="icon" type="image/jpeg" href="/background.jpeg">

  <style>
    body {
      background: #020617;
      color: white;
      font-family: 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }

    .card {
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid #38bdf8;
      padding: 40px;
      border-radius: 12px;
      text-align: center;
      box-shadow: 0 0 30px rgba(56, 189, 248, 0.2);
      max-width: 500px;
      width: 100%;
      box-sizing: border-box;
    }

    h1 {
      color: #38bdf8;
      margin-bottom: 20px;
      font-size: 24px;
      letter-spacing: 1px;
    }

    p {
      font-size: 18px;
      margin: 10px 0;
      color: #e2e8f0;
    }

    .sub {
      font-size: 14px;
      color: #94a3b8;
      margin-top: 20px;
      border-top: 1px solid #1e293b;
      padding-top: 20px;
    }

    .sub b {
      color: #38bdf8;
    }

    @media (max-width: 480px) {
      .card {
        padding: 25px 20px;
      }

      h1 {
        font-size: 21px;
      }

      p {
        font-size: 16px;
      }
    }
  </style>
</head>

<body>
  <div class="card">
    <h1>${escapeHTML(title)}</h1>
    <p>${escapeHTML(message)}</p>
    <div class="sub">${subMessage}</div>
  </div>
</body>
</html>
`;

// --------------------------------------------------
// TELEGRAM TESTİ
// --------------------------------------------------

router.get("/test-telegram", verifyAdmin, async (req, res) => {
  // Yerel ortamda gerçek Telegram bildirimi gönderme.
  if (!IS_PRODUCTION) {
    return res.status(403).send(
      "Yerel ortamda gerçek Telegram bildirimi devre dışı."
    );
  }

  try {
    const result = await sendTelegramAlert(
      "✅ Telegram entegrasyonu başarılı!"
    );

    // Yalnızca gerçekten gönderilmiş mesaj başarılıdır.
    if (result?.sent === true) {
      return res.status(200).send(
        "Telegram bildirim testi başarıyla gönderildi."
      );
    }

    // Bildirim gönderimi bilerek devre dışı bırakılmış.
    if (result?.skipped === true) {
      console.warn(
        "Telegram test bildirimi atlandı:",
        result.reason || "Bildirim gönderimi devre dışı."
      );

      return res.status(503).send(
        "Telegram bildirimi gönderilmedi: " +
        escapeHTML(
          result.reason || "Bildirim gönderimi devre dışı."
        )
      );
    }

    // Telegram servisi hata döndürdü veya beklenmeyen sonuç verdi.
    console.error(
      "Telegram test bildirimi başarısız:",
      result?.error || "Bilinmeyen Telegram servis sonucu."
    );

    return res.status(502).send(
      "Telegram bildirimi gönderilemedi."
    );

  } catch (err) {
    console.error(
      "Telegram test hatası:",
      err.message
    );

    return res.status(502).send(
      "Telegram bildirimi gönderilemedi."
    );
  }
});

// --------------------------------------------------
// SİSTEM DURUMU
// --------------------------------------------------

router.get("/status", verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT last_fetch
      FROM system_log
      ORDER BY id DESC
      LIMIT 1
    `);

    const lastFetch = result.rows[0]?.last_fetch;

    const trDate = lastFetch
      ? new Date(lastFetch)
          .toLocaleString("tr-TR", {
            timeZone: "Europe/Istanbul",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          })
          .replace(/\//g, ".")
      : "Veri yok";

    return res.send(
      adminLayout(
        "📊 SİSTEM DURUMU",
        "🛡️ Sistem Aktif ve Kayıtta.",
        `Son Veri Çekimi: <b>${escapeHTML(trDate)}</b>`
      )
    );

  } catch (err) {
    console.error(
      "Sistem durumu sorgulama hatası:",
      err.message
    );

    return res.status(500).send(
      "Sistem durumu alınırken bir hata oluştu."
    );
  }
});

// --------------------------------------------------
// MANUEL GÜNCELLEME
// --------------------------------------------------

let lastManualUpdate = 0;

const UPDATE_COOLDOWN = 5 * 60 * 1000;

router.get("/force-update", verifyAdmin, async (req, res) => {
  const now = Date.now();

  // Beş dakikalık bekleme kontrolü.
  if (now - lastManualUpdate < UPDATE_COOLDOWN) {
    const kalan = Math.ceil(
      (UPDATE_COOLDOWN - (now - lastManualUpdate)) / 1000
    );

    return res.status(429).send(
      adminLayout(
        "⏳ İŞLEM BEKLETİLDİ",
        "⚠️ Güncelleme çok sık tetikleniyor.",
        `Sistemi yormamak için <b>${kalan} saniye</b> sonra tekrar deneyin.`
      )
    );
  }

  // Bekleme süresini işlem girişiminden itibaren başlat.
  lastManualUpdate = now;

  try {
    const result = await fetchAndSave();

    // Yerel ortam veya devam eden başka işlem.
    if (result?.skipped) {
      return res.status(409).send(
        adminLayout(
          "⏳ İŞLEM GERÇEKLEŞTİRİLEMEDİ",
          "⚠️ Güncelleme işlemi gerçekleştirilmedi.",
          escapeHTML(
            result.reason ||
            "İşlem şu anda gerçekleştirilemiyor."
          )
        )
      );
    }

    // Güncelleme başarısız.
    if (result?.success !== true) {
      console.error(
        "Manuel güncelleme başarısız:",
        result?.error || "Bilinmeyen güncelleme hatası."
      );

      return res.status(500).send(
        adminLayout(
          "❌ GÜNCELLEME BAŞARISIZ",
          "Veritabanı güncellenemedi.",
          "Hata kaydı sunucu günlüklerine yazıldı."
        )
      );
    }

    // Veri değişikliği yok.
    if (result.updated === false) {
      return res.send(
        adminLayout(
          "ℹ️ SİSTEM GÜNCEL",
          "Yeni bir veri değişikliği bulunamadı.",
          "Oyuncu verileri zaten güncel."
        )
      );
    }

    // Beklenmeyen sonuç: başarı olarak gösterme.
    if (result.updated !== true) {
      console.error(
        "Manuel güncelleme beklenmeyen sonuç döndürdü:",
        result
      );

      return res.status(500).send(
        adminLayout(
          "❌ GÜNCELLEME SONUCU BELİRSİZ",
          "İşlemin sonucu doğrulanamadı.",
          "Lütfen sunucu günlüklerini kontrol edin."
        )
      );
    }

    // Güncelleme başarılı.
    return res.send(
      adminLayout(
        "⚙️ İŞLEM BAŞARILI",
        "✅ Oyuncu istatistikleri güncellendi.",
        `Güncellenen oyuncu sayısı: <b>${Number(result.playerCount) || 0}</b>`
      )
    );

  } catch (err) {
    console.error(
      "Manuel güncelleme hatası:",
      err.message
    );

    return res.status(500).send(
      adminLayout(
        "❌ GÜNCELLEME HATASI",
        "Manuel güncelleme sırasında hata oluştu.",
        "Lütfen sunucu günlüklerini kontrol edin."
      )
    );
  }
});

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = router;