
const { Pool } = require("pg");

// --------------------------------------------------
// VERİTABANI ORTAM KONTROLÜ
// --------------------------------------------------

const NODE_ENV = process.env.NODE_ENV || "development";
const DATABASE_URL = process.env.DATABASE_URL;

if (!["development", "test", "production"].includes(NODE_ENV)) {
  throw new Error(`Geçersiz NODE_ENV değeri: ${NODE_ENV}`);
}

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL tanımlanmamış. Veritabanı bağlantısı başlatılamıyor."
  );
}

let databaseHost;

try {
  const databaseUrl = new URL(DATABASE_URL);

  if (
    databaseUrl.protocol !== "postgres:" &&
    databaseUrl.protocol !== "postgresql:"
  ) {
    throw new Error("Geçersiz veritabanı bağlantı protokolü.");
  }

  databaseHost = databaseUrl.hostname.toLowerCase();
} catch (err) {
  throw new Error(`DATABASE_URL geçersiz: ${err.message}`);
}

// --------------------------------------------------
// YEREL ORTAM GÜVENLİĞİ
// --------------------------------------------------

const LOCAL_DATABASE_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1"
];

if (NODE_ENV !== "production") {
  if (!LOCAL_DATABASE_HOSTS.includes(databaseHost)) {
    throw new Error(
      "GÜVENLİK ENGELİ: Yerel geliştirme ortamında uzak veritabanına bağlantı yasak. " +
      "DATABASE_URL yalnızca localhost veritabanını göstermelidir."
    );
  }

  console.log("🛡️ Yerel veritabanı güvenlik kontrolü başarılı.");
}

// --------------------------------------------------
// POSTGRESQL BAĞLANTI HAVUZU
// --------------------------------------------------

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

pool.on("error", (err) => {
  console.error(
    "⚠️ Veritabanı havuzunda beklenmedik hata:",
    err.message
  );
});

// --------------------------------------------------
// VERİTABANI TABLOLARINI OLUŞTURMA
// --------------------------------------------------

async function initDB() {
  let client;

  try {
    client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        nick TEXT UNIQUE,
        total_kills INT DEFAULT 0,
        total_deaths INT DEFAULT 0,
        total_damage INT DEFAULT 0,
        last_kills INT DEFAULT 0,
        last_deaths INT DEFAULT 0,
        last_damage INT DEFAULT 0,
        hs_percent FLOAT DEFAULT 0,
        accuracy FLOAT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_nick_lower
      ON players (LOWER(nick));

      CREATE TABLE IF NOT EXISTS system_log (
        id SERIAL PRIMARY KEY,
        last_fetch TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_hash TEXT
      );
    `);

    console.log("⚔️ Arşiv Sistemi Aktif.");
  } catch (err) {
    console.error(
      "❌ Veritabanı başlatma hatası:",
      err.message
    );

    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = {
  pool,
  initDB
};