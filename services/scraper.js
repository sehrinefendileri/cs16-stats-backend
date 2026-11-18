const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://panel25.oyunyoneticisi.com/rank/rank_all.php?ip=95.173.173.81";

async function fetchPlayers(retry = 2) {
  try {
    const { data } = await axios.get(BASE_URL, { timeout: 8000 });
    const $ = cheerio.load(data);
    let players = [];
    const rows = $("table.CSS_Table_Example tr").length ? $("table.CSS_Table_Example tr") : $("table tr");

    const firstRowCols = $(rows[0]).find("td, th");
    const kHeader = $(firstRowCols[2]).text().toLowerCase();
    const dHeader = $(firstRowCols[4]).text().toLowerCase();
    const dmgHeader = $(firstRowCols[7]).text().toLowerCase();

    if (!kHeader.includes("öldürme") || !dHeader.includes("ölüm") || (!dmgHeader.includes("zarar") && !dmgHeader.includes("damage"))) {
        throw new Error("KRİTİK HATA: OyunYöneticisi sütun yerlerini değiştirmiş! Arşiv korumaya alındı.");
    }

    rows.each((i, row) => {
      if (i === 0) return;
      const cols = $(row).find("td");
      if (cols.length !== 8) return;
      const nick = $(cols[1]).text().trim();
      if (!nick || nick.includes("Toplam")) return;
      players.push({
        nick, kills: parseInt($(cols[2]).text()) || 0,
        hsPercent: parseFloat($(cols[3]).text().match(/\((.*?)%\)/)?.[1]) || 0,
        deaths: parseInt($(cols[4]).text()) || 0,
        accuracy: parseFloat($(cols[6]).text().match(/\((.*?)%\)/)?.[1]) || 0,
        damage: parseInt($(cols[7]).text()) || 0
      });
    });

    const validPlayers = players.filter(p => {
      if (!p.nick || p.nick.length > 32) return false;
      if (p.kills < 0 || p.deaths < 0 || p.damage < 0) return false;
      if (p.kills > 150000 || p.deaths > 150000) return false;
      if (p.hsPercent < 0 || p.hsPercent > 100) return false;
      if (p.accuracy < 0 || p.accuracy > 100) return false;
      return true;
    });

    if (validPlayers.length < players.length * 0.7) {
      throw new Error("KRİTİK HATA: Sütunlar karışmış veya mantıksız veriler var! Arşiv korumaya alındı.");
    }
    return validPlayers;

    } catch (err) {
    if (retry > 0) return fetchPlayers(retry - 1);
    throw err;
  }
}

module.exports = fetchPlayers;