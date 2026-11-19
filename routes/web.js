const express = require("express");
const { pool } = require("../config/database");
const { getCache } = require("../services/scheduler");

const router = express.Router();

// --------------------------------------------------
// AYARLAR
// --------------------------------------------------

const logoUrl = "https://sehrinefendileri.github.io/banner.jpg";
const CACHE_DURATION = 30000;
const PAGE_LIMIT = 100;
const MAX_PAGE = 1000000;

// --------------------------------------------------
// GÜVENLİ HTML KAÇIŞI
// --------------------------------------------------

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// --------------------------------------------------
// TARİH BİÇİMLENDİRME
// --------------------------------------------------

function formatDate(value) {
  if (!value) return "---";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "---";
  }

  return date
    .toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
    .replace(/\//g, ".");
}

// --------------------------------------------------
// ANA SAYFA
// --------------------------------------------------

router.get("/", async (req, res) => {
  const userAgent = req.headers["user-agent"] || "";
  const isMobile = /Mobile|Android|iPhone/i.test(userAgent);

  // Canlı sistemdeki arama davranışını koru.
  const search =
    typeof req.query.search === "string"
      ? req.query.search.toLowerCase()
      : "";

  // Sayfa numarasını doğrula.
  const rawPage = req.query.page;
  let page = 1;

  if (
    typeof rawPage === "string" &&
    /^\d+$/.test(rawPage)
  ) {
    const requestedPage = Number(rawPage);

    if (Number.isSafeInteger(requestedPage)) {
      page = Math.max(
        1,
        Math.min(requestedPage, MAX_PAGE)
      );
    }
  }

  try {
    const cache = getCache();

    // --------------------------------------------------
    // İLK ÖNBELLEK KONTROLÜ
    // --------------------------------------------------

    const requestedCacheKey = JSON.stringify([
      search,
      page,
      isMobile
    ]);

    const requestedCachedPage = cache[requestedCacheKey];

    if (
      requestedCachedPage &&
      requestedCachedPage.html &&
      Date.now() - requestedCachedPage.time < CACHE_DURATION
    ) {
      return res.send(requestedCachedPage.html);
    }

    // --------------------------------------------------
    // TOPLAM OYUNCU SAYISI
    // --------------------------------------------------

    const totalRes = await pool.query(
      `SELECT COUNT(*) FROM players WHERE LOWER(nick) LIKE $1`,
      [`%${search}%`]
    );

    const totalPlayers = Number.parseInt(
      totalRes.rows[0].count,
      10
    ) || 0;

    const totalPages = Math.max(
      1,
      Math.ceil(totalPlayers / PAGE_LIMIT)
    );

    page = Math.min(page, totalPages);

    const offset = (page - 1) * PAGE_LIMIT;

    const cacheKey = JSON.stringify([
      search,
      page,
      isMobile
    ]);

    // --------------------------------------------------
    // İKİNCİ ÖNBELLEK KONTROLÜ
    // --------------------------------------------------

    const cachedPage = cache[cacheKey];

    if (
      cachedPage &&
      cachedPage.html &&
      Date.now() - cachedPage.time < CACHE_DURATION
    ) {
      return res.send(cachedPage.html);
    }

    // --------------------------------------------------
    // OYUNCU SIRALAMA SORGUSU
    // CANLI SİSTEMİN SKOR VE RANK MANTIĞI KORUNDU.
    // --------------------------------------------------

    const query = `
      WITH all_ranked AS (
        SELECT
          *,
          (total_kills - total_deaths) AS net_kills,
          (
            total_kills::float /
            GREATEST(total_deaths, 1)
          ) AS kd,
          RANK() OVER (
            ORDER BY (
              ((total_kills - total_deaths) * 1.0) +
              (
                (total_kills::float /
                GREATEST(total_deaths, 1)) * 5.0
              ) +
              (hs_percent * 1.5) +
              (total_damage / 1000.0)
            ) DESC
          ) AS real_rank
        FROM players
      )
      SELECT
        *,
        (
          (net_kills * 1.0) +
          (kd * 5.0) +
          (hs_percent * 1.5) +
          (total_damage / 1000.0)
        ) AS score
      FROM all_ranked
      WHERE LOWER(nick) LIKE $1
      ORDER BY score DESC
      LIMIT $2 OFFSET $3
    `;

    // --------------------------------------------------
    // SON VERİ GÜNCELLEME TARİHİ
    // --------------------------------------------------

    const logRes = await pool.query(`
      SELECT last_fetch
      FROM system_log
      ORDER BY id DESC
      LIMIT 1
    `);

    // --------------------------------------------------
    // OYUNCU VERİLERİ
    // --------------------------------------------------

    const result = await pool.query(query, [
      `%${search}%`,
      PAGE_LIMIT,
      offset
    ]);

    const players = result.rows;
    const rawDate = logRes.rows[0]?.last_fetch;
    const lastUpdateDate = formatDate(rawDate);

    // --------------------------------------------------
    // SAYFALAMA URL'LERİ
    // --------------------------------------------------

    const encodedSearch = encodeURIComponent(search);

    const previousPageUrl =
      `/?page=${page - 1}` +
      (search ? `&search=${encodedSearch}` : "");

    const nextPageUrl =
      `/?page=${page + 1}` +
      (search ? `&search=${encodedSearch}` : "");

    // --------------------------------------------------
    // HTML ARAYÜZÜ
    // --------------------------------------------------

    const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-EGWK9NSWZ2"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      dataLayer.push(arguments);
    }
    gtag('js', new Date());
    gtag('config', 'G-EGWK9NSWZ2');
  </script>

  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ŞEHRİN EFENDİLERİ</title>

  <meta
    property="og:title"
    content="ŞEHRİN EFENDİLERİ | CS 1.6 İstatistik"
  >
  <meta
    property="og:description"
    content="Sunucumuzun tüm zamanlar skor tabloları, K/D oranları ve detaylı istatistikleri. Sıralamanı hemen kontrol et!"
  >
  <meta property="og:image" content="${logoUrl}">
  <meta property="og:url" content="https://cs16-stats.onrender.com/">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#38bdf8">
  <link rel="icon" type="image/jpeg" href="/background.jpeg">

  <link rel="stylesheet" href="/css/style.css">
</head>

<body style="--page-bg: url('${logoUrl}')">
  <div class="header-container">
    <h1 class="main-title">ŞEHRİN EFENDİLERİ</h1>
    <div class="ip-title">(95.173.173.81)</div>
  </div>

  <div class="content-wrapper">
    <div class="status-board">
      <div class="status-item">
        ⚠️ Veriler <span>06.04.2026</span> tarihinden itibaren kaydedilmektedir.
      </div>

      <div class="status-item update-time">
        Sıralama verileri en son
        <span>${escapeHTML(lastUpdateDate)}</span>
        tarihinde güncellendi.
      </div>
    </div>

    <div class="desktop-tip">
      💡 <b>İpucu:</b>
      Verilere daha detaylı bakabilmek için tarayıcı ayarlarından
      <b>"Masaüstü sitesi"</b> seçeneğini işaretleyebilirsiniz.
    </div>

    <form class="search" method="GET">
      <input
        name="search"
        placeholder="Aranacak nicki giriniz..."
        value="${escapeHTML(search)}"
      >
      <button type="submit">Oyuncu Ara</button>
      ${search ? `<a href="/" class="reset-btn">Temizle</a>` : ""}
    </form>

    <div class="skor-bilgi-karti">
      <div class="skor-baslik">
        <span class="icon"></span>
        Skor Nasıl Hesaplanır?
      </div>

      <div class="skor-aciklama">
        <span class="net-kill">Net Öldürme</span>
        (Öldürme − Ölüm),
        <span class="kd-oran">K/D oranı</span>,
        <span class="hs-yuzde">HS yüzdesi</span>
        ve
        <span class="toplam-hasar">toplam hasar</span>
        dikkate alınarak hesaplanır.
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="sortable desc">SIRA</th>
            <th class="sortable">NICK</th>
            <th class="sortable">ÖLDÜRME</th>
            <th class="sortable">ÖLÜM</th>
            <th class="sortable">K/D</th>
            <th class="sortable">HASAR</th>
            <th class="sortable">SKOR</th>
          </tr>
        </thead>

        <tbody>
          ${players.map((p) => {
            const kills = Number(p.total_kills) || 0;
            const deaths = Number(p.total_deaths) || 0;
            const damage = Number(p.total_damage) || 0;
            const score = Number(p.score) || 0;
            const kd = kills / Math.max(deaths, 1);
            const rank = Number.parseInt(p.real_rank, 10);

            let rankDisplay = `<b>${rank}</b>`;
            let rowClass = "";

            if (rank === 1) {
              rankDisplay = `<span class="rank-badge rank-1">🥇 1</span>`;
              rowClass = "row-rank-1";
            } else if (rank === 2) {
              rankDisplay = `<span class="rank-badge rank-2">🥈 2</span>`;
              rowClass = "row-rank-2";
            } else if (rank === 3) {
              rankDisplay = `<span class="rank-badge rank-3">🥉 3</span>`;
              rowClass = "row-rank-3";
            }

            return `
              <tr class="${rowClass}">
                <td>${rankDisplay}</td>
                <td>
                  <span class="player-nick">${escapeHTML(p.nick)}</span>
                </td>
                <td>${kills}</td>
                <td>${deaths}</td>
                <td>${kd.toFixed(2)}</td>
                <td>${damage}</td>
                <td>
                  <b style="color:#38bdf8; font-size:16px;">
                    ${Math.round(score)}
                  </b>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      ${
        page > 1
          ? `<a href="${previousPageUrl}">« Önceki Sayfa</a>`
          : ""
      }

      <span>Sayfa ${page} / ${totalPages}</span>

      ${
        page < totalPages
          ? `<a href="${nextPageUrl}">Sonraki Sayfa »</a>`
          : ""
      }
    </div>
  </div>

<script src="/js/app.js" defer></script>

</body>
</html>`;

    // --------------------------------------------------
    // ÖNBELLEĞE KAYDET
    // --------------------------------------------------

    cache[cacheKey] = {
      html,
      time: Date.now()
    };

    return res.send(html);

  } catch (err) {
    console.error("Web arayüzü hatası:", err.message);

    return res.status(500).send(
      "Sunucu hatası, lütfen daha sonra tekrar deneyin."
    );
  }
});

// --------------------------------------------------
// DIŞA AKTARIM
// --------------------------------------------------

module.exports = router;