import { Router } from "express";
import { query, queryOne } from "../db/pool.js";

export const leaderboardRouter = Router();

/**
 * GET /api/leaderboard/:slug
 *
 * Ranked personal bests for one category of a game.
 *
 * PB reduction uses Postgres DISTINCT ON (runner_id) ordered by
 * (time_ms ASC, submitted_at ASC). That is an index-friendly equivalent of
 * ROW_NUMBER() OVER (PARTITION BY runner_id ORDER BY time_ms, submitted_at)
 * and pairs with runs_pb_idx (category_id, runner_id, time_ms, submitted_at)
 * WHERE status = 'verified'. We prefer DISTINCT ON over a window function
 * here because the planner can stop per-runner once the first qualifying
 * row is found, and the outer query only materializes one page of results
 * (LIMIT/OFFSET) — bounded memory regardless of board size.
 *
 * Banned runners are excluded at read time so lifting a ban restores their
 * times without rewriting run rows.
 */
leaderboardRouter.get("/:slug", async (req, res) => {
  const slug = req.params.slug;
  const catSlug = typeof req.query.cat === "string" ? req.query.cat : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  // Hard cap page size so a client cannot force a multi-megabyte response.
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const game = await queryOne<{ id: number; name: string; slug: string; platform: string }>(
    `SELECT id, name, slug, platform FROM games WHERE slug = $1`,
    [slug]
  );
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const categories = await query<{
    id: number;
    slug: string;
    name: string;
    rules: string;
  }>(`SELECT id, slug, name, rules FROM categories WHERE game_id = $1 ORDER BY name`, [game.id]);

  const category =
    (catSlug
      ? categories.find((c) => c.slug === catSlug)
      : categories[0]) ?? null;

  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  // Parameter positions: $1 = category_id, then optional q / platform,
  // then LIMIT/OFFSET. Built once and shared by count + page queries.
  const params: unknown[] = [category.id];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
  }
  if (platform) {
    params.push(platform);
  }

  const countRow = await queryOne<{ total: string }>(`
    SELECT COUNT(*) AS total FROM (
      SELECT DISTINCT ON (r.runner_id) r.id
      FROM runs r
      JOIN runners rn ON rn.id = r.runner_id
      WHERE r.category_id = $1
        AND r.status = 'verified'
        AND rn.banned = false
        ${q ? `AND lower(rn.name) LIKE $2` : ""}
        ${platform ? `AND r.platform = $${q ? 3 : 2}` : ""}
      ORDER BY r.runner_id, r.time_ms ASC, r.submitted_at ASC
    ) pb
  `, params);

  const total = Number(countRow?.total ?? 0);

  params.push(pageSize, offset);
  const rows = await query<{
    id: number;
    time_ms: number;
    platform: string;
    emulator: boolean;
    video_url: string | null;
    submitted_at: string;
    verified_at: string | null;
    runner_id: number;
    runner_name: string;
    runner_country: string;
  }>(`
    SELECT * FROM (
      SELECT DISTINCT ON (r.runner_id)
        r.id, r.time_ms, r.platform, r.emulator, r.video_url,
        r.submitted_at, r.verified_at,
        rn.id AS runner_id, rn.name AS runner_name, rn.country AS runner_country
      FROM runs r
      JOIN runners rn ON rn.id = r.runner_id
      WHERE r.category_id = $1
        AND r.status = 'verified'
        AND rn.banned = false
        ${q ? `AND lower(rn.name) LIKE $2` : ""}
        ${platform ? `AND r.platform = $${q ? 3 : 2}` : ""}
      ORDER BY r.runner_id, r.time_ms ASC, r.submitted_at ASC
    ) pb
    ORDER BY pb.time_ms ASC, pb.submitted_at ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const wrMs = rows[0]?.time_ms ?? null;

  res.json({
    game,
    category,
    categories,
    page,
    pageSize,
    total,
    wrMs,
    entries: rows.map((r, i) => ({
      rank: offset + i + 1,
      runId: r.id,
      timeMs: r.time_ms,
      deltaMs: wrMs != null ? r.time_ms - wrMs : null,
      platform: r.platform,
      emulator: r.emulator,
      videoUrl: r.video_url,
      submittedAt: r.submitted_at,
      verifiedAt: r.verified_at,
      runner: {
        id: r.runner_id,
        name: r.runner_name,
        country: r.runner_country,
      },
    })),
  });
});

/**
 * GET /api/leaderboard/:slug/export
 * Same filters, returns CSV of the full (filtered) board.
 */
leaderboardRouter.get("/:slug/export", async (req, res) => {
  const slug = req.params.slug;
  const catSlug = typeof req.query.cat === "string" ? req.query.cat : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;

  const game = await queryOne<{ id: number; name: string }>(
    `SELECT id, name FROM games WHERE slug = $1`,
    [slug]
  );
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const category = catSlug
    ? await queryOne<{ id: number; name: string; slug: string }>(
        `SELECT id, name, slug FROM categories WHERE game_id = $1 AND slug = $2`,
        [game.id, catSlug]
      )
    : await queryOne<{ id: number; name: string; slug: string }>(
        `SELECT id, name, slug FROM categories WHERE game_id = $1 ORDER BY name LIMIT 1`,
        [game.id]
      );

  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }

  const params: unknown[] = [category.id];
  let filterSql = "";
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    filterSql += ` AND lower(rn.name) LIKE $${params.length}`;
  }
  if (platform) {
    params.push(platform);
    filterSql += ` AND r.platform = $${params.length}`;
  }

  const rows = await query<{
    time_ms: number;
    platform: string;
    emulator: boolean;
    submitted_at: string;
    runner_name: string;
    runner_country: string;
  }>(`
    SELECT * FROM (
      SELECT DISTINCT ON (r.runner_id)
        r.time_ms, r.platform, r.emulator, r.submitted_at,
        rn.name AS runner_name, rn.country AS runner_country
      FROM runs r
      JOIN runners rn ON rn.id = r.runner_id
      WHERE r.category_id = $1
        AND r.status = 'verified'
        AND rn.banned = false
        ${filterSql}
      ORDER BY r.runner_id, r.time_ms ASC, r.submitted_at ASC
    ) pb
    ORDER BY pb.time_ms ASC
  `, params);

  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    "rank,runner,country,time_ms,time,platform,emulator,submitted_at",
    ...rows.map((r, i) => {
      const h = Math.floor(r.time_ms / 3600000);
      const m = Math.floor((r.time_ms % 3600000) / 60000);
      const s = Math.floor((r.time_ms % 60000) / 1000);
      const ms = r.time_ms % 1000;
      const timeStr =
        h > 0
          ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
          : `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
      return [
        i + 1,
        escape(r.runner_name),
        r.runner_country,
        r.time_ms,
        timeStr,
        r.platform,
        r.emulator,
        r.submitted_at,
      ].join(",");
    }),
  ];

  const filename = `${slug}-${category.slug}-leaderboard.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});
