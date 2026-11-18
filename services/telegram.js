const axios = require("axios");

// --------------------------------------------------
// ORTAM AYARLARI
// --------------------------------------------------

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

const DISABLE_EXTERNAL_NOTIFICATIONS =
  process.env.DISABLE_EXTERNAL_NOTIFICATIONS === "true";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --------------------------------------------------
// TELEGRAM BİLDİRİMİ
// --------------------------------------------------

const sendTelegramAlert = async (message) => {
  // Yerel ortamda gerçek Telegram mesajı gönderme.
  if (!IS_PRODUCTION) {
    return {
      sent: false,
      skipped: true,
      reason: "Yerel ortamda Telegram bildirimi devre dışı."
    };
  }

  // Harici bildirimler kapalıysa gönderme.
  if (DISABLE_EXTERNAL_NOTIFICATIONS) {
    return {
      sent: false,
      skipped: true,
      reason: "Harici bildirimler devre dışı."
    };
  }

  // Gerekli Telegram bilgilerini kontrol et.
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("⚠️ Telegram bot tokeni veya chat ID tanımlanmamış.");

    return {
      sent: false,
      skipped: false,
      error: "Telegram bot tokeni veya chat ID tanımlanmamış."
    };
  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const safeMessage = String(message || "Bilinmeyen bildirim");

  const text = `🚨 ŞEHRİN EFENDİLERİ - BİLDİRİM

${safeMessage}

Zaman: ${new Date().toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul"
  })}`;

  try {
    const response = await axios.post(
      url,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text
      },
      {
        timeout: 10000
      }
    );

    if (!response.data || response.data.ok !== true) {
      throw new Error(
        response.data?.description || "Telegram API mesajı kabul etmedi."
      );
    }

    console.log("📨 Telegram bildirimi başarıyla gönderildi.");

    return {
      sent: true,
      skipped: false
    };

  } catch (err) {
    console.error(
      "Telegram mesajı gönderilemedi:",
      err.message
    );

    return {
      sent: false,
      skipped: false,
      error: err.message
    };
  }
};

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = sendTelegramAlert;