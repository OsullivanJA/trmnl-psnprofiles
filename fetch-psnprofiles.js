import * as cheerio from "cheerio";
import fs from "fs";
import { execSync } from "child_process";

const URL = "https://psnprofiles.com/OSullivanJA";
const OUT_FILE = "psnprofiles.json";

function cleanText($el) {
  return $el.text().replace(/\s+/g, " ").trim();
}

function textNumber($, selector) {
  const t = $(selector).first().text().replace(/\s+/g, " ").trim();
  const m = t.match(/([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

function statValue($, el) {
  return cheerio.load(el)
    .root()
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();
}

function fetchHtmlWithCurl() {
  // Use a realistic user agent to avoid basic blocks
  const cmd = `curl -L -s -A "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Mobile Safari/537.36" "${URL}"`;
  return execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function extractProfileImage($) {
  // Tries common selectors for avatar
  const candidates = ["#user-bar img.avatar", "#user-bar img", "img.avatar"];
  for (const sel of candidates) {
    const src = $(sel).first().attr("src");
    if (src && src.startsWith("http")) return src;
  }
  return "";
}

function extractStats($) {
  const stats = {};

  $(".stats span.stat").each((_, el) => {
    const label = cleanText($(el).find("span").last());
    const value = $(el).clone().children().remove().end().text().trim();
    if (label) stats[label] = value;
  });

  const worldRank = $(".stats .rank a").clone().children().remove().end().text().trim();
  const countryRank = $(".stats .country-rank a").clone().children().remove().end().text().trim();

  if (worldRank) stats["World Rank"] = worldRank;
  if (countryRank) stats["Country Rank"] = countryRank;

  return stats;
}

function extractRecentTrophies($) {
  const recent_trophies = [];

  $("#recent-trophies > li").each((i, li) => {
    if (i >= 5) return false;

    const trophyName = cleanText($(li).find("a.title").first());
    const earnedLine = cleanText($(li).find(".small_info_green"));
    const game = earnedLine.split(" in ").slice(1).join(" in ").trim();
    const rarityLabel = cleanText($(li).find(".typo-bottom nobr").first());

    recent_trophies.push({ trophyName, game, rarityLabel });
  });

  return recent_trophies;
}

function extractRecentGames($) {
  const recent_games = [];

  $("#gamesTable > tbody > tr").each((i, tr) => {
    if (i >= 5) return false;

    const title = cleanText($(tr).find("a.title").first());
    const trophyInfo = cleanText($(tr).find("div.small-info").first());

    let trophies_earned = null;
    let trophies_total = null;

    let m = trophyInfo.match(/(\d+)\s+of\s+(\d+)\s+Trophies/i);
    if (m) {
      trophies_earned = parseInt(m[1], 10);
      trophies_total = parseInt(m[2], 10);
    } else {
      m = trophyInfo.match(/All\s+(\d+)\s+Trophies/i);
      if (m) {
        trophies_earned = parseInt(m[1], 10);
        trophies_total = parseInt(m[1], 10);
      }
    }

    recent_games.push({ title, trophies_earned, trophies_total });
  });

  return recent_games;
}

function loadPreviousJson() {
  try {
    if (fs.existsSync(OUT_FILE)) {
      return JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    }
  } catch {}
  return null;
}

async function run() {
  const html = fetchHtmlWithCurl();

  // Optional: save debug snapshot to help if blocked later
  fs.writeFileSync("debug.html", html);

  const $ = cheerio.load(html);

  const hasUserBar = $("#user-bar").length > 0;

  if (!hasUserBar) {
    console.error("❌ Could not find #user-bar. Likely bot protection / interstitial page.");

    // Do not overwrite last good JSON
    const prev = loadPreviousJson();
    if (prev) {
      console.log("✅ Keeping previous psnprofiles.json (did not overwrite).");
      return;
    }

    const fallback = {
      source: URL,
      updated: new Date().toISOString(),
      error: "Blocked by bot protection (no #user-bar found).",
      username: "",
      level: 0,
      profile_image: "",
      trophies: { total: null, platinum: null, gold: null, silver: null, bronze: null },
      stats: {},
      recent_trophies: [],
      recent_games: []
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(fallback, null, 2));
    return;
  }

  const username = cleanText($("#user-bar .username").first());
  const level = Number(cleanText($("#user-bar .level-box span").first()));
  const profile_image = extractProfileImage($);

  const trophies = {
    total: textNumber($, "#user-bar li.total"),
    platinum: textNumber($, "#user-bar li.platinum"),
    gold: textNumber($, "#user-bar li.gold"),
    silver: textNumber($, "#user-bar li.silver"),
    bronze: textNumber($, "#user-bar li.bronze")
  };

  const stats = extractStats($);
  const recent_trophies = extractRecentTrophies($);
  const recent_games = extractRecentGames($);

  const output = {
    source: URL,
    updated: new Date().toISOString(),
    username,
    level,
    profile_image,
    trophies,
    stats,
    recent_trophies,
    recent_games
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("✅ Wrote psnprofiles.json");
  console.log(`User: ${username} | Level: ${level}`);
}

run().catch((e) => {
  console.error("❌ Error:", e.message);

  // Keep previous json if it exists
  const prev = loadPreviousJson();
  if (prev) {
    console.log("✅ Keeping previous psnprofiles.json (did not overwrite).");
    process.exit(0);
  }

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        source: URL,
        updated: new Date().toISOString(),
        error: e.message,
        username: "",
        level: 0,
        profile_image: "",
        trophies: { total: null, platinum: null, gold: null, silver: null, bronze: null },
        stats: {},
        recent_trophies: [],
        recent_games: []
      },
      null,
      2
    )
  );

  process.exit(0);
});
