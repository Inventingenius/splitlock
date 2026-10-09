/**
 * Seed script for Splitlock.
 *
 * Generates a realistic volume of games, runners, runs, reviews and bans
 * so the app feels real without a multi-minute first boot.
 *
 * Memory / throughput notes:
 *  - Rows are accumulated in memory in batches of BATCH_SIZE, then flushed
 *    as a single multi-row INSERT. That bounds peak RSS (roughly
 *    batch × row width) while keeping parse/plan overhead low versus
 *    one INSERT per row.
 *  - Parameter arrays are rebuilt per flush and released so the V8 heap
 *    can reclaim between batches.
 *
 * Time distribution:
 *  - factor = 1.05 + U^1.4 * 1.8  yields a right-skewed spread around WR:
 *    most times sit 5–80% slower than the reference WR; the power > 1
 *    concentrates mass near the front of the board the way real
 *    leaderboards do.
 */
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://splitlock:splitlock@localhost:5432/splitlock";

const RUN_COUNT = Number(process.env.SEED_RUNS || 60000);
const RUNNER_COUNT = Number(process.env.SEED_RUNNERS || 3500);

const GAMES = [
  { id: 1, slug: "super-mario-64", name: "Super Mario 64", short_name: "SM64", year: 1996, platform: "N64", genre: "Platformer", hue: 210, wr_base_ms: 401000 },
  { id: 2, slug: "oot", name: "The Legend of Zelda: Ocarina of Time", short_name: "OoT", year: 1998, platform: "N64", genre: "Action-Adventure", hue: 45, wr_base_ms: 1020000 },
  { id: 3, slug: "celeste", name: "Celeste", short_name: "Celeste", year: 2018, platform: "PC", genre: "Platformer", hue: 330, wr_base_ms: 1620000 },
  { id: 4, slug: "hollow-knight", name: "Hollow Knight", short_name: "HK", year: 2017, platform: "PC", genre: "Metroidvania", hue: 200, wr_base_ms: 2100000 },
  { id: 5, slug: "portal", name: "Portal", short_name: "Portal", year: 2007, platform: "PC", genre: "Puzzle", hue: 25, wr_base_ms: 420000 },
  { id: 6, slug: "smw", name: "Super Mario World", short_name: "SMW", year: 1990, platform: "SNES", genre: "Platformer", hue: 140, wr_base_ms: 680000 },
  { id: 7, slug: "dkc", name: "Donkey Kong Country", short_name: "DKC", year: 1994, platform: "SNES", genre: "Platformer", hue: 30, wr_base_ms: 950000 },
  { id: 8, slug: "metroid-prime", name: "Metroid Prime", short_name: "MP", year: 2002, platform: "GC", genre: "Action-Adventure", hue: 170, wr_base_ms: 3600000 },
  { id: 9, slug: "smash-melee", name: "Super Smash Bros. Melee", short_name: "Melee", year: 2001, platform: "GC", genre: "Fighting", hue: 0, wr_base_ms: 180000 },
  { id: 10, slug: "hl2", name: "Half-Life 2", short_name: "HL2", year: 2004, platform: "PC", genre: "FPS", hue: 15, wr_base_ms: 2400000 },
];

const CATEGORIES = [
  // SM64
  { id: 1, game_id: 1, slug: "120-star", name: "120 Star", rules: "Collect all 120 stars. Emulator allowed.", wr_base_ms: 4010000, checkpoints: ["Bob-omb Battlefield", "Whomp's Fortress", "Cool, Cool Mountain", "Jolly Roger Bay", "Bowser in the Dark World", "Shifting Sand Land", "Lethal Lava Land", "Dire Dire Docks", "Snowman's Land", "Wet-Dry World", "Tall Tall Mountain", "Tiny-Huge Island", "Tick Tock Clock", "Rainbow Ride", "Bowser in the Sky"] },
  { id: 2, game_id: 1, slug: "70-star", name: "70 Star", rules: "Any 70 stars. No BLJ.", wr_base_ms: 2800000, checkpoints: ["15 Stars", "30 Stars", "50 Stars", "70 Stars"] },
  { id: 3, game_id: 1, slug: "16-star", name: "16 Star", rules: "Any% with BLJ. Classic route.", wr_base_ms: 401000, checkpoints: ["Lobby", "Basement", "Upper Floors", "Bowser"] },
  // OoT
  { id: 4, game_id: 2, slug: "any", name: "Any%", rules: "Beat Ganon. Glitches allowed.", wr_base_ms: 1020000, checkpoints: ["Deku Tree", "Dodongo's Cavern", "Jabu-Jabu", "Forest Temple", "Fire Temple", "Water Temple", "Shadow Temple", "Spirit Temple", "Ganon"] },
  { id: 5, game_id: 2, slug: "glitchless", name: "Glitchless", rules: "No glitches. Restricted routes.", wr_base_ms: 4800000, checkpoints: ["Child", "Adult", "Temples", "Ganon"] },
  // Celeste
  { id: 6, game_id: 3, slug: "any", name: "Any%", rules: "Beat the game. Assist mode off.", wr_base_ms: 1620000, checkpoints: ["Forsaken City", "Old Site", "Celestial Resort", "Golden Ridge", "Mirror Temple", "Reflection", "The Summit"] },
  { id: 7, game_id: 3, slug: "100", name: "100%", rules: "All strawberries, cassettes, hearts.", wr_base_ms: 5400000, checkpoints: ["Ch1", "Ch2", "Ch3", "Ch4", "Ch5", "Ch6", "Ch7", "B-sides", "C-sides"] },
  // Hollow Knight
  { id: 8, game_id: 4, slug: "any", name: "Any%", rules: "Defeat Hollow Knight.", wr_base_ms: 2100000, checkpoints: ["Forgotten Crossroads", "Greenpath", "Fungal Wastes", "City of Tears", "Kingdom's Edge", "Deepnest", "Black Egg"] },
  { id: 9, game_id: 4, slug: "112", name: "112%", rules: "All content including Godmaster.", wr_base_ms: 7200000, checkpoints: ["Crossroads", "Greenpath", "Fungal", "City", "Deepnest", "Kingdom's Edge", "Godmaster"] },
  // Portal
  { id: 10, game_id: 5, slug: "any", name: "Any%", rules: "Beat GLaDOS. No ABA.", wr_base_ms: 420000, checkpoints: ["Chamber 00-05", "Chamber 06-10", "Chamber 11-15", "Chamber 16-19", "Escape"] },
  // SMW
  { id: 11, game_id: 6, slug: "any", name: "Any%", rules: "Beat Bowser. Credits warp allowed.", wr_base_ms: 680000, checkpoints: ["Yoshi's Island", "Donut Plains", "Vanilla Dome", "Cookie Mountain", "Front Door"] },
  { id: 12, game_id: 6, slug: "96-exit", name: "96 Exit", rules: "All exits.", wr_base_ms: 4200000, checkpoints: ["YI", "DP", "VD", "CM", "VB", "CI", "Forest", "Bowser"] },
  // DKC
  { id: 13, game_id: 7, slug: "any", name: "Any%", rules: "Beat K. Rool.", wr_base_ms: 950000, checkpoints: ["Kongo Jungle", "Monkey Mines", "Vine Valley", "Gorilla Glacier", "Kremkroc", "Chimp Caverns"] },
  // Metroid Prime
  { id: 14, game_id: 8, slug: "any", name: "Any%", rules: "Beat Metroid Prime. Soft resets OK.", wr_base_ms: 3600000, checkpoints: ["Space Pirate Frigate", "Tallon Overworld", "Chozo Ruins", "Magmoor", "Phendrana", "Mines", "Impact Crater"] },
  // Melee
  { id: 15, game_id: 9, slug: "adventure", name: "Adventure", rules: "Beat Adventure Mode.", wr_base_ms: 180000, checkpoints: ["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Stage 5", "Final"] },
  // HL2
  { id: 16, game_id: 10, slug: "any", name: "Any%", rules: "Beat the game. Glitches allowed.", wr_base_ms: 2400000, checkpoints: ["Point Insertion", "Route Kanal", "Water Hazard", "Black Mesa East", "Ravenholm", "Highway 17", "Nova Prospekt", "Citadel"] },
];

const MODERATORS = [
  { id: "mod-alice", name: "Alice Chen", handle: "alice", title: "Senior Moderator" },
  { id: "mod-bob", name: "Bob Okonkwo", handle: "bob", title: "Moderator" },
  { id: "mod-cara", name: "Cara Nguyen", handle: "cara", title: "Moderator" },
  { id: "mod-diego", name: "Diego Silva", handle: "diego", title: "Junior Moderator" },
  { id: "mod-eva", name: "Eva Kowalski", handle: "eva", title: "Moderator" },
];

// Alice covers classic N64 / SNES, Bob covers modern PC, etc.
const MOD_GAMES = [
  { moderator_id: "mod-alice", game_id: 1 },
  { moderator_id: "mod-alice", game_id: 2 },
  { moderator_id: "mod-alice", game_id: 6 },
  { moderator_id: "mod-alice", game_id: 7 },
  { moderator_id: "mod-bob", game_id: 3 },
  { moderator_id: "mod-bob", game_id: 4 },
  { moderator_id: "mod-bob", game_id: 5 },
  { moderator_id: "mod-bob", game_id: 10 },
  { moderator_id: "mod-cara", game_id: 8 },
  { moderator_id: "mod-cara", game_id: 9 },
  { moderator_id: "mod-cara", game_id: 1 },
  { moderator_id: "mod-diego", game_id: 3 },
  { moderator_id: "mod-diego", game_id: 6 },
  { moderator_id: "mod-eva", game_id: 2 },
  { moderator_id: "mod-eva", game_id: 4 },
  { moderator_id: "mod-eva", game_id: 5 },
];

const FIRST = ["Ace", "Blaze", "Cipher", "Drift", "Echo", "Flux", "Ghost", "Hex", "Ivy", "Jinx", "Kai", "Luna", "Mako", "Nyx", "Orion", "Pixel", "Quinn", "Raven", "Sage", "Taro", "Umbra", "Vex", "Wisp", "Xander", "Yuki", "Zed", "Aria", "Bolt", "Clove", "Dash", "Ember", "Frost", "Glitch", "Haze", "Iris", "Jolt", "Kite", "Lynx", "Mira", "Nova", "Onyx", "Pulse", "Quill", "Rogue", "Spark", "Tide", "Vapor", "Wolf", "Yara", "Zephyr"];
const LAST = ["Speed", "Frame", "Split", "Gate", "Route", "Skip", "Warp", "Clip", "Dash", "Boost", "Runner", "Timer", "Clock", "Lag", "Input", "Buffer", "Edge", "Pixel", "Byte", "Core", "Link", "Node", "Path", "Quest", "Raid", "Save", "Slot", "Track", "Vault", "Zone"];
const COUNTRIES = ["US", "JP", "DE", "BR", "CA", "AU", "GB", "FR", "KR", "SE", "NL", "PL", "ES", "IT", "MX", "AR", "NO", "FI", "DK", "NZ"];

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function chance(p) {
  return Math.random() < p;
}

function formatName(i) {
  // mostly unique names
  return `${rand(FIRST)}${rand(LAST)}${i > 2000 ? i : ""}`;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  console.log(`Seeding into ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")} …`);
  console.log(`Target: ${RUNNER_COUNT} runners, ~${RUN_COUNT} runs`);

  try {
    await client.query("BEGIN");

    // Clear in dependency order
    await client.query("TRUNCATE splits, reviews, bans, runs, moderator_games, moderators, runners, categories, games RESTART IDENTITY CASCADE");

    // Games
    for (const g of GAMES) {
      await client.query(
        `INSERT INTO games (id, slug, name, short_name, year, platform, genre, hue, wr_base_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [g.id, g.slug, g.name, g.short_name, g.year, g.platform, g.genre, g.hue, g.wr_base_ms]
      );
    }
    console.log(`  ${GAMES.length} games`);

    // Categories
    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO categories (id, game_id, slug, name, rules, wr_base_ms, checkpoints)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [c.id, c.game_id, c.slug, c.name, c.rules, c.wr_base_ms, JSON.stringify(c.checkpoints)]
      );
    }
    console.log(`  ${CATEGORIES.length} categories`);

    // Moderators
    for (const m of MODERATORS) {
      await client.query(
        `INSERT INTO moderators (id, name, handle, title) VALUES ($1,$2,$3,$4)`,
        [m.id, m.name, m.handle, m.title]
      );
    }
    for (const mg of MOD_GAMES) {
      await client.query(
        `INSERT INTO moderator_games (moderator_id, game_id) VALUES ($1,$2)`,
        [mg.moderator_id, mg.game_id]
      );
    }
    console.log(`  ${MODERATORS.length} moderators`);

    // Runners
    const runners = [];
    const usedNames = new Set();
    for (let i = 1; i <= RUNNER_COUNT; i++) {
      let name = formatName(i);
      while (usedNames.has(name)) name = formatName(i) + randInt(1, 999);
      usedNames.add(name);
      const joined = new Date(Date.UTC(2018, 0, 1) + Math.random() * (Date.now() - Date.UTC(2018, 0, 1)));
      const banned = chance(0.012); // ~1.2% banned
      runners.push({ id: i, name, country: rand(COUNTRIES), joined_at: joined, banned });
    }

    // Bulk insert runners
    const runnerValues = [];
    const runnerParams = [];
    let p = 1;
    for (const r of runners) {
      runnerValues.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
      runnerParams.push(r.id, r.name, r.country, r.joined_at.toISOString(), r.banned);
    }
    await client.query(
      `INSERT INTO runners (id, name, country, joined_at, banned) VALUES ${runnerValues.join(",")}`,
      runnerParams
    );
    console.log(`  ${runners.length} runners`);

    // Bans for banned runners
    let banCount = 0;
    for (const r of runners.filter((x) => x.banned)) {
      const mod = rand(MODERATORS);
      const created = new Date(r.joined_at.getTime() + randInt(30, 800) * 86400000);
      const lifted = chance(0.25); // some bans already lifted
      await client.query(
        `INSERT INTO bans (runner_id, moderator_id, reason, created_at, lifted_at, lift_reason, lifted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          r.id,
          mod.id,
          rand(["Tool-assisted input detected", "Stolen VOD", "Savestate abuse", "Illegal glitch on glitchless board", "Multiple accounts"]),
          created.toISOString(),
          lifted ? new Date(created.getTime() + randInt(7, 90) * 86400000).toISOString() : null,
          lifted ? "Appeal accepted — insufficient evidence" : null,
          lifted ? rand(MODERATORS).id : null,
        ]
      );
      // Keep banned flag consistent with active ban
      if (lifted) {
        await client.query(`UPDATE runners SET banned = false WHERE id = $1`, [r.id]);
        r.banned = false;
      }
      banCount++;
    }
    console.log(`  ${banCount} ban records`);

    // Runs — batched inserts keep client memory O(batch) rather than O(N).
    const statuses = ["verified", "verified", "verified", "verified", "pending", "rejected"];
    const platforms = ["N64", "SNES", "GC", "PC", "Switch", "Emulator"];
    let runId = 1;
    const BATCH_SIZE = 2000;
    let batch = [];
    let reviewBatch = [];
    let splitBatch = [];

    const catByGame = {};
    for (const c of CATEGORIES) {
      (catByGame[c.game_id] ||= []).push(c);
    }

    async function flush() {
      if (batch.length === 0) return;
      const vals = [];
      const params = [];
      let pi = 1;
      for (const row of batch) {
        vals.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++})`);
        params.push(...row);
      }
      await client.query(
        `INSERT INTO runs (id, game_id, category_id, runner_id, time_ms, status, platform, emulator, video_url, comment, submitted_at, verified_at)
         VALUES ${vals.join(",")}`,
        params
      );

      if (reviewBatch.length) {
        const rvals = [];
        const rparams = [];
        let ri = 1;
        for (const row of reviewBatch) {
          rvals.push(`($${ri++},$${ri++},$${ri++},$${ri++},$${ri++})`);
          rparams.push(...row);
        }
        await client.query(
          `INSERT INTO reviews (run_id, moderator_id, action, note, created_at) VALUES ${rvals.join(",")}`,
          rparams
        );
      }

      if (splitBatch.length) {
        const svals = [];
        const sparams = [];
        let si = 1;
        for (const row of splitBatch) {
          svals.push(`($${si++},$${si++},$${si++},$${si++})`);
          sparams.push(...row);
        }
        await client.query(
          `INSERT INTO splits (run_id, checkpoint, time_ms, order_index) VALUES ${svals.join(",")}`,
          sparams
        );
      }

      batch = [];
      reviewBatch = [];
      splitBatch = [];
    }

    const now = Date.now();
    for (let i = 0; i < RUN_COUNT; i++) {
      const game = rand(GAMES);
      const cats = catByGame[game.id];
      const cat = rand(cats);
      const runner = rand(runners);
      // Right-skewed around WR (see file header). ±500ms jitter avoids
      // pathological exact-duplicate times on dense boards.
      const factor = 1.05 + Math.pow(Math.random(), 1.4) * 1.8;
      const timeMs = Math.round(cat.wr_base_ms * factor + randInt(-500, 500));
      const status = runner.banned && chance(0.7) ? "rejected" : rand(statuses);
      // more pending near the end of the timeline
      const ageDays = status === "pending" ? randInt(0, 14) : randInt(0, 900);
      const submitted = new Date(now - ageDays * 86400000 - randInt(0, 86400000));
      const platform = chance(0.15) ? "Emulator" : game.platform === "PC" ? "PC" : rand([game.platform, "Emulator"]);
      const emulator = platform === "Emulator" || (game.platform !== "PC" && chance(0.08));
      const videoUrl = chance(0.92) ? `https://www.youtube.com/watch?v=dQw4w9WgXcQ` : null;
      const comment = chance(0.25)
        ? rand([
            "First PB this month!",
            "Almost died at the end",
            "New route, still learning",
            "TAS comparison later",
            "Softlocked once, still counted",
            null,
          ])
        : null;

      let verifiedAt = null;
      if (status === "verified") {
        verifiedAt = new Date(submitted.getTime() + randInt(1, 72) * 3600000);
      }

      batch.push([
        runId,
        game.id,
        cat.id,
        runner.id,
        Math.max(1000, timeMs),
        status,
        platform,
        emulator,
        videoUrl,
        comment,
        submitted.toISOString(),
        verifiedAt ? verifiedAt.toISOString() : null,
      ]);

      // Reviews
      reviewBatch.push([runId, null, "submitted", null, submitted.toISOString()]);
      if (status === "verified" || status === "rejected") {
        const mod = rand(MODERATORS.filter((m) => MOD_GAMES.some((mg) => mg.moderator_id === m.id && mg.game_id === game.id)) || MODERATORS);
        const action = status === "verified" ? "approved" : "rejected";
        const note =
          action === "rejected"
            ? rand(["Missing segment", "Suspicious split times", "Wrong category", "Video incomplete", "Emulator on console-only board"])
            : chance(0.3)
              ? rand(["Clean run", "Nice PB", "Verified against encode", null])
              : null;
        reviewBatch.push([
          runId,
          mod.id,
          action,
          note,
          (verifiedAt || new Date(submitted.getTime() + 3600000)).toISOString(),
        ]);
      }

      // Splits (subset of checkpoints)
      const cps = cat.checkpoints || [];
      let cumulative = 0;
      const total = Math.max(1000, timeMs);
      for (let si = 0; si < cps.length; si++) {
        const remaining = cps.length - si;
        const portion = si === cps.length - 1 ? total - cumulative : Math.round((total - cumulative) / remaining * (0.7 + Math.random() * 0.6));
        cumulative = Math.min(total, cumulative + Math.max(100, portion));
        splitBatch.push([runId, cps[si], cumulative, si]);
      }

      runId++;
      if (batch.length >= BATCH_SIZE) {
        await flush();
        if (i % 10000 === 0 && i > 0) console.log(`  … ${i} runs`);
      }
    }
    await flush();
    console.log(`  ${runId - 1} runs + reviews + splits`);

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
