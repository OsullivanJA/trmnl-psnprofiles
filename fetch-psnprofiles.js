import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getUserTrophyProfileSummary,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  getTitleTrophies,
} from "psn-api";
import fs from "fs";

const NPSSO = process.env.PSN_NPSSO;
const USERNAME = "OSullivanJA";
const OUT_FILE = "psnprofiles.json";

// PSNProfiles avatar URL — used as fallback if the PSN API doesn't return one.
const FALLBACK_AVATAR = "https://i.psnprofiles.com/avatars/m/Gb1a0c14a2.png";

function loadPreviousJson() {
  try {
    if (fs.existsSync(OUT_FILE)) {
      return JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    }
  } catch {}
  return null;
}

function sumTrophies(t) {
  return (t.platinum || 0) + (t.gold || 0) + (t.silver || 0) + (t.bronze || 0);
}

function rarityFromRate(rate) {
  const r = parseFloat(rate);
  if (isNaN(r)) return "Common";
  if (r <= 5)   return "Ultra Rare";
  if (r <= 15)  return "Very Rare";
  if (r <= 30)  return "Rare";
  if (r <= 50)  return "Uncommon";
  return "Common";
}

async function getRecentTrophies(authorization, recentTitles) {
  const allEarned = [];

  for (const title of recentTitles) {
    // PS3, PS4, and PS Vita titles require npServiceName: "trophy"
    const isLegacy = /PS3|PS4|VITA/i.test(title.trophyTitlePlatform || "");
    const svcOpts = isLegacy ? { npServiceName: "trophy" } : {};

    try {
      const [earnedRes, detailRes] = await Promise.all([
        getUserTrophiesEarnedForTitle(authorization, "me", title.npCommunicationId, "all", svcOpts),
        getTitleTrophies(authorization, title.npCommunicationId, "all", svcOpts),
      ]);

      // Map trophyId -> name from the title details
      const nameMap = {};
      for (const t of detailRes.trophies) {
        nameMap[t.trophyId] = t.trophyName || "";
      }

      for (const t of earnedRes.trophies) {
        if (t.earned && t.earnedDateTime) {
          allEarned.push({
            trophyName: nameMap[t.trophyId] || "",
            game: title.trophyTitleName,
            trophyGrade: t.trophyType,          // bronze / silver / gold / platinum
            rarityLabel: rarityFromRate(t.trophyEarnedRate),
            earnedDateTime: t.earnedDateTime,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️  Skipping trophies for "${title.trophyTitleName}": ${err.message}`);
    }
  }

  // Most recently earned first, keep top 5, strip the sort key
  allEarned.sort((a, b) => new Date(b.earnedDateTime) - new Date(a.earnedDateTime));
  return allEarned.slice(0, 5).map(({ earnedDateTime, ...rest }) => rest);
}

async function run() {
  if (!NPSSO) {
    throw new Error(
      "PSN_NPSSO environment variable is not set. " +
      "Visit https://ca.account.sony.com/api/v1/ssocookie while logged into PlayStation.com to get your NPSSO token, " +
      "then set it as a GitHub Actions secret named PSN_NPSSO."
    );
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  let authorization;
  try {
    console.log("🔑 Exchanging NPSSO for access token...");
    const accessCode = await exchangeNpssoForAccessCode(NPSSO);
    authorization = await exchangeAccessCodeForAuthTokens(accessCode);
    console.log("✅ Authorized.");
  } catch (authErr) {
    console.error("❌ Auth failed — NPSSO has likely expired:", authErr.message);
    const prev = loadPreviousJson();
    if (prev) {
      prev.token_expired = true;
      prev.updated = new Date().toISOString();
      fs.writeFileSync(OUT_FILE, JSON.stringify(prev, null, 2));
      console.log("✅ Updated psnprofiles.json with token_expired: true (cached data preserved).");
    }
    return;
  }

  // ── Trophy profile summary (level, trophy counts) ───────────────────────
  const trophySummary = await getUserTrophyProfileSummary(authorization, "me");
  const earned = trophySummary.earnedTrophies;

  // ── All titles (for stats + recent games) ─────────────────────────────────
  // Results are sorted by lastUpdatedDateTime descending — most recently played first.
  console.log("📋 Fetching title list...");
  const titlesResponse = await getUserTitles(authorization, "me", { limit: 800 });
  const allTitles = titlesResponse.trophyTitles;
  const gamesPlayed = titlesResponse.totalItemCount;

  // Completion % across all titles
  let totalEarned = 0;
  let totalDefined = 0;
  let completedGames = 0;

  for (const t of allTitles) {
    totalEarned += sumTrophies(t.earnedTrophies);
    totalDefined += sumTrophies(t.definedTrophies);
    if (t.progress === 100) completedGames++;
  }

  const completionPct =
    totalDefined > 0
      ? ((totalEarned / totalDefined) * 100).toFixed(2) + "%"
      : "0%";

  // ── Recent trophies (from top 3 most recently played games) ────────────────
  console.log("🏆 Fetching recent trophies...");
  const recent_trophies = await getRecentTrophies(authorization, allTitles.slice(0, 3));
  console.log(`   Found ${recent_trophies.length} recent trophies.`);

  // ── Recent games (5 most recently played) ─────────────────────────────────
  const recent_games = allTitles.slice(0, 5).map((t) => ({
    title: t.trophyTitleName,
    trophies_earned: sumTrophies(t.earnedTrophies),
    trophies_total: sumTrophies(t.definedTrophies),
    progress: t.progress ?? 0,
  }));

  // ── Build output ──────────────────────────────────────────────────────────
  const output = {
    source: `https://psnprofiles.com/${USERNAME}`,
    updated: new Date().toISOString(),
    username: USERNAME,
    level: parseInt(trophySummary.trophyLevel, 10),
    level_progress: trophySummary.progress,
    profile_image: FALLBACK_AVATAR,
    trophies: {
      total: sumTrophies(earned),
      platinum: earned.platinum,
      gold: earned.gold,
      silver: earned.silver,
      bronze: earned.bronze,
    },
    stats: {
      "Games Played": String(gamesPlayed),
      "Completed Games": String(completedGames),
      "Completion": completionPct,
    },
    token_expired: false,
    recent_trophies,
    recent_games,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log("✅ Wrote psnprofiles.json");
  console.log(`User: ${output.username} | Level: ${output.level} (${output.level_progress}% to next)`);
  console.log("Trophies:", output.trophies);
  console.log("Recent games:", recent_games.length);
}

run().catch((e) => {
  console.error("❌ Error:", e.message);

  // Preserve the last good JSON rather than overwriting with an error state.
  const prev = loadPreviousJson();
  if (prev) {
    console.log("✅ Keeping previous psnprofiles.json (did not overwrite).");
    process.exit(0);
  }

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        source: `https://psnprofiles.com/${USERNAME}`,
        updated: new Date().toISOString(),
        error: e.message,
        username: "",
        level: 0,
        level_progress: 0,
        profile_image: "",
        trophies: { total: null, platinum: null, gold: null, silver: null, bronze: null },
        stats: {},
        recent_trophies: [],
        recent_games: [],
      },
      null,
      2
    )
  );

  process.exit(0);
});

