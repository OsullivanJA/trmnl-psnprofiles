import { chromium } from "playwright";
import * as cheerio from "cheerio";
import fs from "fs";

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
  // Gets the value part excluding nested <span>Label</span>
  return $(el)
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();
}

async function getPageContent() {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // Speed up: block images/fonts/media (we still parse image URLs from HTML)
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "image" || type === "font" || type === "media") return route.abort();
    return route.continue();
  });

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
  } catch (err) {
    console.error("⚠️ Navigation warning:", err.message);
  }

  const html = await page.content();

  // Save debug output (helpful for troubleshooting)
  fs.writeFileSync("debug.html", html);
  try {
    await page.screenshot({ path: "debug.png", fullPage: true });
  } catch {}

  await browser.close();
  return html;
}

function extractProfileImage($) {
  // PSNProfiles avatar is usually in an <img> element inside #user-bar
  // We try a few common selectors to be resilient.
  const candidates = [
    "#user-bar img.avatar",
    "#user-bar img",
    ".profile img",
    "img.avatar",
  ];

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
    const value = statValue($, el);
    if (label) stats[label] = value;
  });

  // World/Country ranks appear as links with nested <span>
  const worldRank = $(".stats .rank a")
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();

  const countryRank = $(".stats .country-rank a")
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();

  if (worldRank) stats["World Rank"] = worldRank;
  if (countryRank) stats["Country Rank"] = countryRank;

  return stats;
}

function extractRecentTrophies($) {
  const recent_trophies = [];

  $("#recent-trophies > li").each((i, li) => {
    if (i >= 5) return false;

    const trophyName = cleanText($(li).find("a.title").first());

    // e.g. "9 hours ago in Metal Gear Solid Δ: Snake Eater"
    const earnedLine = cleanText($(li).find(".small_info_green"));
    const game = earnedLine.split(" in ").slice(1).join(" in ").trim();

    const rarityLabel = cleanText($(li).find(".typo-bottom nobr").first());

    recent_trophies.push({
      trophyName,
      game,
      rarityLabel
    });
  });

  return recent_trophies;
}

function extractRecentGames($) {
  const recent_games = [];

  $("#gamesTable > tbody > tr").each((i, tr) => {
    if (i >= 5) return false;

    const title = cleanText($(tr).find("a.title").first());

    // "12 of 46 Trophies" or "All 55 Trophies"
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

    recent_games.push({
      title,
      trophies_earned,
      trophies_total
    });
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
  const html = await getPageContent();
  const $ = cheerio.load(html);

  const hasUserBar = $("#user-bar").length > 0;

  if (!hasUserBar) {
    console.error("❌ Could not find #user-bar. Likely bot protection / interstitial page.");

    // IMPORTANT: do NOT overwrite previous good JSON.
    const prev = loadPreviousJson();
    if (prev) {
      console.log("✅ Keeping previous psnprofiles.json (did not overwrite).");
      return;
    }

    // If no previous JSON exists, write a minimal placeholder
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
    console.log("✅ Wrote fallback psnprofiles.json");
    return;
  }

  // Username + Level
  const username = cleanText($("#user-bar .username").first());
  const level = Number(cleanText($("#user-bar .level-box span").first()));

  // Profile photo
  const profile_image = extractProfileImage($);

  // Trophy counts
  const trophies = {
    total: textNumber($, "#user-bar li.total"),
    platinum: textNumber($, "#user-bar li.platinum"),
    gold: textNumber($, "#user-bar li.gold"),
    silver: textNumber($, "#user-bar li.silver"),
    bronze: textNumber($, "#user-bar li.bronze"),
  };

  // Stats row (Games played, Completion, Points, World Rank, Country Rank, etc.)
  const stats = extractStats($);

  // Recent trophies (5)
  const recent_trophies = extractRecentTrophies($);

  // Recent games (5)
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
  console.log("Trophies:", trophies);
  console.log("Recent trophies:", recent_trophies.length);
  console.log("Recent games:", recent_games.length);
}

run().catch((e) => {
  console.error("❌ Error:", e.message);

  // Do NOT overwrite good output if we already have it
  const prev = loadPreviousJson();
  if (prev) {
    console.log("✅ Keeping previous psnprofiles.json (did not overwrite).");
    process.exit(0);
  }

  // Write minimal fallback if nothing exists yet
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
