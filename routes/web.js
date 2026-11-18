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

  <style>
    body {
      background:
        linear-gradient(
          rgba(15, 23, 42, 0.85),
          rgba(15, 23, 42, 0.85)
        ),
        url('${logoUrl}') no-repeat center center fixed;
      background-size: cover;
      color: white;
      font-family: 'Segoe UI', sans-serif;
      margin: 0;
      padding-bottom: 50px;
      overflow-x: hidden;
    }

    .header-container {
      text-align: center;
      padding: 40px 10px 20px;
      background: rgba(2, 6, 23, 0.7);
    }

    .main-title {
      font-size: clamp(28px, 6vw, 48px);
      font-weight: 900;
      letter-spacing: 3px;
      margin: 0;
      text-shadow: 0 0 20px rgba(56, 189, 248, 0.6);
      color: #fff;
    }

    .ip-title {
      color: #38bdf8;
      font-size: clamp(18px, 4vw, 28px);
      margin: 10px 0;
      font-weight: 600;
    }

    .content-wrapper {
      width: 98%;
      max-width: 1400px;
      margin: 0 auto;
    }

    .status-board {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 15px;
      background: linear-gradient(
        145deg,
        rgba(30, 41, 59, 0.9),
        rgba(15, 23, 42, 0.9)
      );
      border: 2px solid #38bdf8;
      border-radius: 16px;
      padding: 25px;
      margin: 30px auto;
      max-width: 900px;
      box-shadow:
        0 0 25px rgba(56, 189, 248, 0.2),
        inset 0 0 15px rgba(0, 0, 0, 0.5);
    }

    .status-item {
      font-size: 18px;
      text-align: center;
      color: #e2e8f0;
    }

    .status-item span {
      color: #facc15;
      font-weight: 800;
      font-size: 20px;
      text-shadow: 0 0 10px rgba(250, 204, 21, 0.5);
    }

    .status-item.update-time span {
      color: #34d399;
      text-shadow: 0 0 10px rgba(52, 211, 153, 0.5);
    }

    .desktop-tip {
      display: none;
      text-align: center;
      background: rgba(250, 204, 21, 0.1);
      border: 1px solid rgba(250, 204, 21, 0.4);
      padding: 12px 15px;
      margin: 0 auto 20px;
      border-radius: 8px;
      font-size: 14px;
      color: #fde047;
      max-width: 95%;
    }

    .search {
      text-align: center;
      margin: 30px 0;
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    input {
      padding: 16px;
      border-radius: 8px;
      border: 2px solid #334155;
      width: 55%;
      background: rgba(30, 41, 59, 0.8);
      color: white;
      outline: none;
      font-size: 16px;
      transition: 0.3s;
    }

    input:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 15px rgba(56, 189, 248, 0.3);
    }

    button {
      padding: 16px 35px;
      border-radius: 8px;
      background: linear-gradient(135deg, #0ea5e9, #0284c7);
      color: white;
      font-weight: bold;
      border: none;
      cursor: pointer;
      font-size: 16px;
      transition: 0.3s;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(14, 165, 233, 0.4);
    }

    .reset-btn {
      padding: 16px 25px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.9);
      border: 2px solid #ef4444;
      color: #ef4444;
      font-weight: bold;
      text-decoration: none;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: 0.3s;
    }

    .reset-btn:hover {
      background: #ef4444;
      color: white;
    }

    .table-container {
      width: 100%;
      overflow-x: auto;
      background: rgba(15, 23, 42, 0.95);
      border-radius: 12px;
      border: 1px solid #1e293b;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      min-width: 800px;
    }

    th, td {
      border-bottom: 1px solid #1e293b;
      padding: 16px 10px;
      text-align: center;
      font-size: 15px;
    }

    th.sortable {
      background: #020617;
      color: #38bdf8;
      text-transform: uppercase;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 1px;
      cursor: pointer;
      position: relative;
      padding-right: 20px;
      transition: 0.2s;
      user-select: none;
      border-bottom: 2px solid #334155;
    }

    th.sortable:hover {
      background: rgba(56, 189, 248, 0.15);
      color: #fff;
    }

    th.sortable::after {
      content: '↕';
      position: absolute;
      right: 8px;
      color: #64748b;
      font-size: 14px;
    }

    th.sortable.asc::after {
      content: '▲';
      color: #38bdf8;
    }

    th.sortable.desc::after {
      content: '▼';
      color: #38bdf8;
    }

    tr:hover td {
      background: rgba(56, 189, 248, 0.15) !important;
    }

    tr:nth-child(even) td {
      background: rgba(30, 41, 59, 0.3);
    }

    .row-rank-1 {
      background: rgba(250, 204, 21, 0.12) !important;
      border-left: 4px solid #facc15;
    }

    .row-rank-2 {
      background: rgba(226, 232, 240, 0.1) !important;
      border-left: 4px solid #e2e8f0;
    }

    .row-rank-3 {
      background: rgba(253, 186, 116, 0.1) !important;
      border-left: 4px solid #fdba74;
    }

    .player-nick {
      color: #e0f2fe;
      font-weight: 600;
      text-align: left;
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
      font-size: 16px;
    }

    .rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      min-width: 55px;
      border-radius: 8px;
      font-weight: 900;
      font-size: 15px;
      gap: 5px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .rank-1 {
      background: linear-gradient(135deg, #facc15, #eab308);
      color: #422006;
      border: 1px solid #fef08a;
    }

    .rank-2 {
      background: linear-gradient(135deg, #e2e8f0, #94a3b8);
      color: #0f172a;
      border: 1px solid #f8fafc;
    }

    .rank-3 {
      background: linear-gradient(135deg, #fdba74, #ea580c);
      color: #431407;
      border: 1px solid #fed7aa;
    }

    .pagination {
      display: flex;
      justify-content: center;
      gap: 15px;
      margin: 40px 0;
      align-items: center;
    }

    .pagination a {
      background: rgba(30, 41, 59, 0.9);
      border: 2px solid #38bdf8;
      color: #38bdf8;
      padding: 12px 25px;
      border-radius: 8px;
      font-weight: bold;
      text-decoration: none;
      transition: 0.3s;
    }

    .pagination a:hover {
      background: #38bdf8;
      color: #020617;
    }

    .pagination span {
      background: #020617;
      border: 2px solid #1e293b;
      color: white;
      padding: 12px 25px;
      border-radius: 8px;
      font-weight: bold;
    }

    .skor-bilgi-karti {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: linear-gradient(
        145deg,
        rgba(30, 41, 59, 0.9),
        rgba(15, 23, 42, 0.9)
      );
      border: 2px solid #38bdf8;
      border-radius: 16px;
      padding: 16px 25px;
      margin: 0 auto 30px auto;
      max-width: 900px;
      box-shadow:
        0 0 25px rgba(56, 189, 248, 0.2),
        inset 0 0 15px rgba(0, 0, 0, 0.5);
      text-align: center;
    }

    .skor-baslik {
      color: #fff;
      font-size: 18px;
      font-weight: 800;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .skor-baslik span.icon {
      font-size: 22px;
    }

    .skor-aciklama {
      color: #cbd5e1;
      font-size: 15px;
      line-height: 1.6;
    }

    .net-kill {
      color: #facc15;
      font-weight: 700;
    }

    .kd-oran {
      color: #38bdf8;
      font-weight: 700;
    }

    .hs-yuzde {
      color: #34d399;
      font-weight: 700;
    }

    .toplam-hasar {
      color: #fb7185;
      font-weight: 700;
    }

    @media (max-width: 768px) {
      .status-board {
        padding: 15px;
        margin: 20px 10px;
      }

      .status-item {
        font-size: 15px;
      }

      .status-item span {
        font-size: 16px;
      }

      .desktop-tip {
        display: block;
      }

      input {
        width: 100%;
      }

      th:nth-child(2),
      td:nth-child(2) {
        position: sticky !important;
        left: 0 !important;
        z-index: 99 !important;
        background: #0f172a !important;
        width: 140px !important;
        box-shadow: 3px 0 10px rgba(0, 0, 0, 0.6);
        border-right: 1px solid #334155;
      }

      th:nth-child(2) {
        z-index: 100 !important;
      }

      tr:hover td:nth-child(2) {
        background: #1e293b !important;
      }

      .pagination {
        flex-direction: column;
        width: 90%;
        margin: 20px auto;
        gap: 10px;
      }

      .skor-bilgi-karti {
        padding: 15px;
        margin: 0 10px 25px 10px;
      }
    }
  </style>
</head>

<body>
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

  <script>
    document.addEventListener("DOMContentLoaded", function() {
      const headers = document.querySelectorAll("th.sortable");

      headers.forEach(th => {
        th.addEventListener("click", function() {
          const table = th.closest("table");
          const tbody = table.querySelector("tbody");
          const rows = Array.from(tbody.querySelectorAll("tr"));

          const index = Array.from(
            th.parentNode.children
          ).indexOf(th);

          const isAscending = th.classList.contains("asc");

          headers.forEach(header => {
            header.classList.remove("asc", "desc");
          });

          th.classList.add(isAscending ? "desc" : "asc");

          const numericColumns = [0, 2, 3, 4, 5, 6];

          rows.sort((a, b) => {
            const aText = a.children[index].innerText.trim();
            const bText = b.children[index].innerText.trim();

            if (numericColumns.includes(index)) {
              const aNum = Number(
                aText.replace(/[^0-9.-]+/g, "")
              );

              const bNum = Number(
                bText.replace(/[^0-9.-]+/g, "")
              );

              return isAscending
                ? aNum - bNum
                : bNum - aNum;
            }

            return isAscending
              ? aText.localeCompare(bText, "tr")
              : bText.localeCompare(aText, "tr");
          });

          rows.forEach(row => tbody.appendChild(row));
        });
      });
    });
  </script>
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