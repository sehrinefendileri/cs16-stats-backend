const path = require("path");

// --------------------------------------------------
// ORTAM DEĞİŞKENLERİNİ YÜKLE
// --------------------------------------------------

const dotenv = require("dotenv");

// Render ortamını belirle.
const IS_RENDER =
  process.env.RENDER === "true" ||
  Boolean(process.env.RENDER_SERVICE_ID);

// Başlangıç ortamını belirle.
const INITIAL_NODE_ENV = process.env.NODE_ENV;

if (IS_RENDER) {
  // Render yalnızca production ortamında çalışabilir.
  if (INITIAL_NODE_ENV !== "production") {
    console.error(
      "❌ Render ortamında NODE_ENV=production olmalıdır."
    );
    process.exit(1);
  }
} else {
  // Yerel bilgisayarda production çalışmasını engelle.
  if (INITIAL_NODE_ENV === "production") {
    console.error(
      "❌ Yerel bilgisayarda production ortamında çalıştırma engellendi."
    );
    process.exit(1);
  }

  const LOCAL_NODE_ENV = INITIAL_NODE_ENV || "development";

  if (!["development", "test"].includes(LOCAL_NODE_ENV)) {
    console.error(
      "❌ Geçersiz yerel NODE_ENV:",
      LOCAL_NODE_ENV
    );
    process.exit(1);
  }

  // Yerel ortam değişkenlerini yükle.
  const envResult = dotenv.config({
    path: path.join(__dirname, ".env.local"),
    override: true
  });

  if (envResult.error) {
    console.error(
      "❌ .env.local dosyası yüklenemedi:",
      envResult.error.message
    );
    process.exit(1);
  }

  // .env.local dosyasının ortam türünü değiştirmesine izin verme.
  process.env.NODE_ENV = LOCAL_NODE_ENV;
}

// --------------------------------------------------
// ORTAM KONTROLÜ
// --------------------------------------------------

const NODE_ENV = process.env.NODE_ENV;
const IS_PRODUCTION = NODE_ENV === "production";
const ENABLE_SCRAPER = process.env.ENABLE_SCRAPER !== "false";

if (!["development", "test", "production"].includes(NODE_ENV)) {
  console.error(
    "❌ Geçersiz NODE_ENV:",
    NODE_ENV
  );
  process.exit(1);
}

// --------------------------------------------------
// ZORUNLU ORTAM DEĞİŞKENLERİ
// --------------------------------------------------

const requiredEnvs = [
  "DATABASE_URL",
  "ADMIN_KEY"
];

if (IS_PRODUCTION) {
  requiredEnvs.push(
    "EMAIL_USER",
    "EMAIL_TO",
    "EMAIL_PASS"
  );
}

const missingEnvs = requiredEnvs.filter(
  (key) => !process.env[key] || !process.env[key].trim()
);

if (missingEnvs.length > 0) {
  console.error(
    `🚨 KRİTİK HATA: Eksik çevresel değişkenler: ${missingEnvs.join(", ")}`
  );
  process.exit(1);
}

// --------------------------------------------------
// PORT KONTROLÜ
// --------------------------------------------------

const PORT = Number(process.env.PORT || 3000);

if (
  !Number.isInteger(PORT) ||
  PORT < 1 ||
  PORT > 65535
) {
  console.error(
    "❌ Geçersiz PORT değeri:",
    process.env.PORT
  );
  process.exit(1);
}

// --------------------------------------------------
// MODÜLLER
// --------------------------------------------------

const express = require("express");

const { pool, initDB } = require("./config/database");

const { rateLimit } = require("./middleware/rateLimit");

const {
  startSchedulers,
  fetchAndSave
} = require("./services/scheduler");

const sendTelegramAlert = require("./services/telegram");

const webRoutes = require("./routes/web");
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");

// --------------------------------------------------
// EXPRESS UYGULAMASI
// --------------------------------------------------

const app = express();

// Render proxy ayarı.
// Yerel ortamda proxy güveni etkinleştirilmez.
if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

// --------------------------------------------------
// STATİK DOSYALAR
// --------------------------------------------------

const publicDirectory = path.join(__dirname, "public");

app.use(express.static(publicDirectory));

// Ana dizindeki background.jpeg dosyasına erişim.
// Orijinal URL korunur.
app.get("/background.jpeg", (req, res) => {
  res.sendFile(
    path.join(__dirname, "background.jpeg"),
    (err) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode || 404).end();
      }
    }
  );
});

// --------------------------------------------------
// VERİTABANI KAPATMA YARDIMCISI
// --------------------------------------------------

async function closePoolAndExit() {
  try {
    await pool.end();
  } catch (err) {
    console.error(
      "❌ Veritabanı bağlantı havuzu kapatılamadı:",
      err.message
    );
  }

  process.exit(1);
}

// --------------------------------------------------
// GLOBAL KRİTİK HATA YAKALAYICILARI
// --------------------------------------------------

let isAlerting = false;

async function criticalErrorHandler(type, err) {
  console.error(`🚨 KRİTİK HATA (${type}):`, err);

  if (isAlerting) {
    return;
  }

  isAlerting = true;

  try {
    const errorDetails =
      err instanceof Error
        ? err.stack || err.message
        : String(err);

    // Telegram bildirimi yalnızca production ortamında gönderilir.
    if (IS_PRODUCTION) {
      await sendTelegramAlert(
        `🚨 ${type}\n\n${errorDetails}`
      );
    }

  } catch (notificationError) {
    console.error(
      "⚠️ Kritik hata bildirimi gönderilemedi:",
      notificationError.message
    );

  } finally {
    await closePoolAndExit();
  }
}

process.on("uncaughtException", (err) => {
  void criticalErrorHandler("Uncaught Exception", err);
});

process.on("unhandledRejection", (reason) => {
  void criticalErrorHandler("Unhandled Rejection", reason);
});

// --------------------------------------------------
// RATE LIMIT
// --------------------------------------------------

app.use((req, res, next) => {
  if (!rateLimit(req)) {
    return res
      .status(429)
      .send("Çok fazla istek yolladınız. Lütfen biraz bekleyin.");
  }

  next();
});

// --------------------------------------------------
// SAĞLIK KONTROLÜ
// --------------------------------------------------

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    return res.status(200).json({
      status: "ok"
    });

  } catch (error) {
    console.error(
      "Sağlık kontrolü hatası:",
      error.message
    );

    return res.status(500).json({
      status: "error"
    });
  }
});

// --------------------------------------------------
// ROTALAR
// --------------------------------------------------

app.use("/", webRoutes);
app.use("/api", apiRoutes);
app.use("/", adminRoutes);

// --------------------------------------------------
// SUNUCUYU BAŞLAT
// --------------------------------------------------

async function startServer() {
  try {
    // Veritabanı başarıyla başlatılmadan sunucu açılmaz.
    await initDB();

    const server = app.listen(PORT, () => {
      console.log(
        `🚀 Şehrin Efendileri Sunucusu ${PORT} portunda aktif!`
      );

      console.log(`🌍 Ortam: ${NODE_ENV}`);

      if (IS_PRODUCTION && ENABLE_SCRAPER) {
        console.log("⚔️ Scraper ve otomatik zamanlayıcılar aktif.");

        // İlk veri güncellemesi.
        fetchAndSave().catch((err) => {
          console.error(
            "❌ İlk veri güncelleme hatası:",
            err.message
          );
        });

        // Otomatik zamanlayıcılar.
        startSchedulers();

      } else if (IS_PRODUCTION) {
        console.log("🛡️ Scraper ve otomatik zamanlayıcılar devre dışı.");

      } else {
        console.log(
          "🛡️ Yerel ortam: Otomatik veri güncelleme ve zamanlayıcılar kapalı."
        );

        console.log(
          "🛡️ Yerel ortam: Telegram kritik hata bildirimleri kapalı."
        );
      }
    });

    server.on("error", (err) => {
      console.error(
        "❌ Sunucu başlatma hatası:",
        err.message
      );

      void closePoolAndExit();
    });

  } catch (err) {
    console.error(
      "❌ Uygulama başlatılamadı:",
      err.message
    );

    await closePoolAndExit();
  }
}

startServer();