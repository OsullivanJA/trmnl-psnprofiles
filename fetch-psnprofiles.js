import { chromium } from "playwright";
import * as cheerio from "cheerio";
import fs from "fs";

const URL = "https://psnprofiles.com/OSullivanJA";
async function getPageContent() {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  // Go to the page and wait for network to settle
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });

  // Give it a moment in case there are dynamic elements / interstitials
  await page.waitForTimeout(2000);

  const html = await page.content();

  // Always write debug files (small, safe, and helpful)
  fs.writeFileSync("debug.html", html);
  await page.screenshot({ path: "debug.png", fullPage: true });

  await browser.close();
  return html;
}
async function getHtmlWithBrowser() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36"
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  await browser.close();
  return html;
}

function textNumber($, selector) {
  const t = $(selector).first().text().replace(/\s+/g, " ").trim();
  const m = t.match(/([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

function cleanText($el) {
  return $el.text().replace(/\s+/g, " ").trim();
}

function statValue($, el) {
  // Gets the value part excluding nested <span>Label</span>
  const value = $(el)
    .clone()
    .children()
    .remove()
    .end()
    .text()
    .trim();
  return value;
}

async function run() {
  const html = await getPageContent();
  const $ = cheerio.load(html);
  const hasUserBar = $("#user-bar").length > 0;
  if (!hasUserBar) {
    console.error("❌ Could not find #user-bar. Likely bot protection / interstitial page.");
    // We still write psnprofiles.json, but it will be empty
  }
  // Username + Level
  const username = cleanText($("#user-bar .username").first());
  const level = Number(cleanText($("#user-bar .level-box span").first()));

  // Trophy counts
  const trophies = {
    total: textNumber($, "#user-bar li.total"),
    platinum: textNumber($, "#user-bar li.platinum"),
    gold: textNumber($, "#user-bar li.gold"),
    silver: textNumber($, "#user-bar li.silver"),
    bronze: textNumber($, "#user-bar li.bronze"),
  };

  // Stats row
  const stats = {};
  $(".stats span.stat").each((_, el) => {
    const label = cleanText($(el).find("span").last());
    const value = statValue($, el);
    if (label) stats[label] = value;
  });

  // World/Country rank are links with nested <span>
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

  // Recent trophies
  const recent = [];
  $("#recent-trophies > li").each((i, li) => {
    if (i >= 5) return false;

    const trophyName = cleanText($(li).find("a.title").first());
    const trophyPath = $(li).find("a.title").attr("href") || "";
    const trophyUrl = trophyPath ? `https://psnprofiles.com${trophyPath}` : "";

    // There are two ellipsis spans; second is description
    const desc = $(li).find("td div.ellipsis span").eq(1);
    const description = cleanText(desc);

    const earnedLine = cleanText($(li).find(".small_info_green"));
    const earned = earnedLine.split(" in ")[0].trim();
    const game = earnedLine.split(" in ").slice(1).join(" in ").trim();

    const rarityPercent = cleanText($(li).find(".typo-top").first());
    const rarityLabel = cleanText($(li).find(".typo-bottom nobr").first());

    const trophyType = $(li).find("img[alt]").last().attr("alt") || "";
    const image = $(li).find("picture.trophy img").attr("src") || "";

    recent.push({
      trophyName,
      description,
      earned,
      game,
      rarityPercent,
      rarityLabel,
      trophyType,
      trophyUrl,
      image,
    });
  });

  const output = {
    source: URL,
    updated: new Date().toISOString(),
    username,
    level,
    trophies,
    stats,
    recent,
  };

  fs.writeFileSync("psnprofiles.json", JSON.stringify(output, null, 2));
  console.log("✅ Wrote psnprofiles.json");
  console.log(`User: ${username} | Level: ${level}`);
  console.log(`Trophies:`, trophies);
}

run().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
