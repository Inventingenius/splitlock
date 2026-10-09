import { Router } from "express";
import { query, queryOne } from "../db/pool.js";
import { requireModerator } from "../middleware/moderator.js";
import {
  computeSuspicion,
  suspicionScore,
  FRAME_TOLERANCE_MS,
} from "../utils/suspicion.js";

export const queueRouter = Router();

/**
 * GET /api/queue
 *
 * Pending runs for the current moderator, optionally scoped to assigned games.
 * Sorted by suspicion score (highest first) in application space.
 *
 * Enrichment (WR / prior PB / clone count / reject history) is currently one
 * round-trip per row on the page. At pageSize ≤ 25 this is acceptable and
 * keeps the SQL simple; at higher throughput, fold those aggregates into a
 * single lateral join or a materialized suspicion column updated on write.
 */
queueRouter.get("/", requireModerator, async (req, res) => {
  const mod = req.moderator!;
  const assignedOnly = req.query.assignedOnly !== "false";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(req.query.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [];
  let where = `r.status = 'pending'`;

  if (assignedOnly && mod.gameIds.length > 0) {
    params.push(mod.gameIds);
    where += ` AND r.game_id = ANY($${params.length})`;
  } else if (assignedOnly) {
    // Moderator has no games assigned — empty queue
    res.json({ total: 0, page, pageSize, items: [] });
    return;
  }

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where += ` AND (lower(rn.name) LIKE $${params.length} OR lower(g.name) LIKE $${params.length})`;
  }

  const countRow = await queryOne<{ total: string }>(`
    SELECT COUNT(*) AS total
    FROM runs r
    JOIN runners rn ON rn.id = r.runner_id
    JOIN games g ON g.id = r.game_id
    WHERE ${where}
  `, params);
  const total = Number(countRow?.total ?? 0);

  params.push(pageSize, offset);
  const rows = await query<{
    id: number;
    time_ms: number;
    platform: string;
    emulator: boolean;
    video_url: string | null;
    comment: string | null;
    submitted_at: string;
    game_id: number;
    game_name: string;
    game_slug: string;
    game_platform: string;
    category_id: number;
    category_name: string;
    runner_id: number;
    runner_name: string;
    runner_country: string;
  }>(`
    SELECT r.id, r.time_ms, r.platform, r.emulator, r.video_url, r.comment, r.submitted_at,
           g.id AS game_id, g.name AS game_name, g.slug AS game_slug, g.platform AS game_platform,
           c.id AS category_id, c.name AS category_name,
           rn.id AS runner_id, rn.name AS runner_name, rn.country AS runner_country
    FROM runs r
    JOIN runners rn ON rn.id = r.runner_id
    JOIN games g ON g.id = r.game_id
    JOIN categories c ON c.id = r.category_id
    WHERE ${where}
    ORDER BY r.submitted_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  // Enrich with suspicion (batched lookups would be better at scale; fine for demo)
  const items = await Promise.all(
    rows.map(async (r) => {
      const wr = await queryOne<{ wr_ms: number }>(`
        SELECT MIN(r2.time_ms) AS wr_ms
        FROM runs r2
        JOIN runners rn2 ON rn2.id = r2.runner_id
        WHERE r2.category_id = $1 AND r2.status = 'verified' AND rn2.banned = false
      `, [r.category_id]);

      const prevPb = await queryOne<{ pb_ms: number }>(`
        SELECT MIN(time_ms) AS pb_ms FROM runs
        WHERE category_id = $1 AND runner_id = $2 AND status = 'verified'
      `, [r.category_id, r.runner_id]);

      const clone = await queryOne<{ cnt: string }>(`
        SELECT COUNT(*) AS cnt FROM runs
        WHERE category_id = $1 AND status = 'verified'
          AND ABS(time_ms - $2) <= $3
      `, [r.category_id, r.time_ms, FRAME_TOLERANCE_MS]);

      const rejected = await queryOne<{ cnt: string }>(`
        SELECT COUNT(*) AS cnt FROM runs WHERE runner_id = $1 AND status = 'rejected'
      `, [r.runner_id]);

      const flags = computeSuspicion({
        timeMs: r.time_ms,
        wrMs: wr?.wr_ms ?? null,
        prevPbMs: prevPb?.pb_ms ?? null,
        cloneCount: Number(clone?.cnt ?? 0),
        emulator: r.emulator,
        platform: r.platform,
        gamePlatform: r.game_platform,
        rejectedCount: Number(rejected?.cnt ?? 0),
        videoUrl: r.video_url,
        comment: r.comment,
      });

      return {
        id: r.id,
        timeMs: r.time_ms,
        platform: r.platform,
        emulator: r.emulator,
        videoUrl: r.video_url,
        comment: r.comment,
        submittedAt: r.submitted_at,
        game: { id: r.game_id, name: r.game_name, slug: r.game_slug },
        category: { id: r.category_id, name: r.category_name },
        runner: { id: r.runner_id, name: r.runner_name, country: r.runner_country },
        suspicion: { score: suspicionScore(flags), flags },
      };
    })
  );

  // Sort by suspicion score descending
  items.sort((a, b) => b.suspicion.score - a.suspicion.score || a.id - b.id);

  res.json({ total, page, pageSize, items });
});
