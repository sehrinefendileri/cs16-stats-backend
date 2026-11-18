const nodemailer = require("nodemailer");

// --------------------------------------------------
// ORTAM AYARLARI
// --------------------------------------------------

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

const DISABLE_EXTERNAL_NOTIFICATIONS =
  process.env.DISABLE_EXTERNAL_NOTIFICATIONS === "true";

const EMAIL_USER = "leventistemi@gmail.com";
const EMAIL_TO = "leventistemi@gmail.com";

const EMAIL_PASS = process.env.EMAIL_PASS;

// --------------------------------------------------
// E-POSTA GÖNDERİM SINIRI
// --------------------------------------------------

const MAIL_COOLDOWN = 60 * 60 * 1000;

let lastMailTime = 0;

// --------------------------------------------------
// SMTP BAĞLANTISI
// --------------------------------------------------

let transporter = null;

function getTransporter() {
  if (!IS_PRODUCTION || DISABLE_EXTERNAL_NOTIFICATIONS) {
    return null;
  }

  if (!EMAIL_PASS) {
    throw new Error("EMAIL_PASS tanımlanmamış.");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });
  }

  return transporter;
}

// --------------------------------------------------
// SİSTEM ARIZA E-POSTASI
// --------------------------------------------------

const sendAlertMail = async (errorMsg) => {
  // Yerel ortamda gerçek e-posta gönderme.
  if (!IS_PRODUCTION) {
    return {
      sent: false,
      skipped: true,
      reason: "Yerel ortamda e-posta gönderimi devre dışı."
    };
  }

  // Bildirimler açıkça devre dışı bırakılmışsa gönderme.
  if (DISABLE_EXTERNAL_NOTIFICATIONS) {
    return {
      sent: false,
      skipped: true,
      reason: "Harici bildirimler devre dışı."
    };
  }

  const now = Date.now();

  // Saatte bir e-posta sınırı.
  if (now - lastMailTime < MAIL_COOLDOWN) {
    return {
      sent: false,
      skipped: true,
      reason: "E-posta gönderim bekleme süresi devam ediyor."
    };
  }

  // Aynı anda birden fazla gönderim girişimini engelle.
  lastMailTime = now;

  try {
    const mailTransporter = getTransporter();

    if (!mailTransporter) {
      return {
        sent: false,
        skipped: true,
        reason: "E-posta servisi kullanılamıyor."
      };
    }

    const safeErrorMessage = String(errorMsg || "Bilinmeyen hata");

    const mailOptions = {
      from: `"Şehrin Efendileri Sistem" <${EMAIL_USER}>`,
      to: EMAIL_TO,
      subject: "⚠️ SİSTEM ARIZA BİLDİRİMİ - ŞEHRİN EFENDİLERİ",
      text: `Merhaba Levent, sistemde bir hata oluştu.

Hata Detayı: ${safeErrorMessage}

Zaman: ${new Date().toLocaleString("tr-TR", {
        timeZone: "Europe/Istanbul"
      })}`
    };

    await mailTransporter.sendMail(mailOptions);

    console.log("📧 Arıza maili başarıyla gönderildi.");

    return {
      sent: true,
      skipped: false
    };

  } catch (err) {
    console.error(
      "Mail gönderme hatası:",
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

module.exports = sendAlertMail;