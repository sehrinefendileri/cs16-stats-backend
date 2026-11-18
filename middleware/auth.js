const ADMIN_KEY = process.env.ADMIN_KEY;

function checkAuth(req, res, next) {
  // Yönetici anahtarı tanımlanmamışsa erişimi kesinlikle reddet.
  if (
    typeof ADMIN_KEY !== "string" ||
    ADMIN_KEY.length === 0
  ) {
    console.error(
      "⚠️ Güvenlik hatası: ADMIN_KEY tanımlanmamış."
    );

    return res.status(403).send("Erişim Reddedildi");
  }

  // İstek başlığındaki API anahtarını al.
  const requestKey = req.get("x-api-key");

  // Anahtar yoksa veya eşleşmiyorsa erişimi reddet.
  if (
    typeof requestKey !== "string" ||
    requestKey.length === 0 ||
    requestKey !== ADMIN_KEY
  ) {
    return res.status(403).send("Erişim Reddedildi");
  }

  next();
}

module.exports = checkAuth;