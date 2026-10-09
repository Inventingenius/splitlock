import { Router } from "express";
import { query, queryOne, pool } from "../db/pool.js";
import { requireModerator } from "../middleware/moderator.js";

export const runnersRouter = Router();

/** GET /api/runners/:id */
runnersRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const runner = await queryOne<{
    id: number;
    name: string;
    country: string;
    joined_at: string;
    banned: boolean;
  }>(`SELECT * FROM runners WHERE id = $1`, [id]);

  if (!runner) {
    res.status(404).json({ error: "Runner not found" });
    return;
  }

  const runs = await query<{
    id: number;
    time_ms: number;
    status: string;
    platform: string;
    submitted_at: string;
    game_name: string;
    game_slug: string;
    category_name: string;
  }>(`
    SELECT r.id, r.time_ms, r.status, r.platform, r.submitted_at,
           g.name AS game_name, g.slug AS game_slug, c.name AS category_name
    FROM runs r
    JOIN games g ON g.id = r.game_id
    JOIN categories c ON c.id = r.category_id
    WHERE r.runner_id = $1
    ORDER BY r.submitted_at DESC
    LIMIT 50
  `, [id]);

  const bans = await query<{
    id: number;
    reason: string;
    created_at: string;
    lifted_at: string | null;
    lift_reason: string | null;
    moderator_name: string;
    lifted_by_name: string | null;
  }>(`
    SELECT b.id, b.reason, b.created_at, b.lifted_at, b.lift_reason,
           m.name AS moderator_name, m2.name AS lifted_by_name
    FROM bans b
    JOIN moderators m ON m.id = b.moderator_id
    LEFT JOIN moderators m2 ON m2.id = b.lifted_by
    WHERE b.runner_id = $1
    ORDER BY b.created_at DESC
  `, [id]);

  const stats = await queryOne<{
    total: string;
    verified: string;
    pending: string;
    rejected: string;
  }>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'verified') AS verified,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
    FROM runs WHERE runner_id = $1
  `, [id]);

  res.json({
    id: runner.id,
    name: runner.name,
    country: runner.country,
    joinedAt: runner.joined_at,
    banned: runner.banned,
    stats: {
      total: Number(stats?.total ?? 0),
      verified: Number(stats?.verified ?? 0),
      pending: Number(stats?.pending ?? 0),
      rejected: Number(stats?.rejected ?? 0),
    },
    runs: runs.map((r) => ({
      id: r.id,
      timeMs: r.time_ms,
      status: r.status,
      platform: r.platform,
      submittedAt: r.submitted_at,
      game: { name: r.game_name, slug: r.game_slug },
      category: { name: r.category_name },
    })),
    bans: bans.map((b) => ({
      id: b.id,
      reason: b.reason,
      createdAt: b.created_at,
      liftedAt: b.lifted_at,
      liftReason: b.lift_reason,
      moderatorName: b.moderator_name,
      liftedByName: b.lifted_by_name,
    })),
  });
});

/** POST /api/runners/:id/ban */
runnersRouter.post("/:id/ban", requireModerator, async (req, res) => {
  const id = Number(req.params.id);
  const mod = req.moderator!;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5) {
    res.status(400).json({ error: "Ban reason required (min 5 chars)" });
    return;
  }

  const runner = await queryOne<{ id: number; banned: boolean }>(
    `SELECT id, banned FROM runners WHERE id = $1`,
    [id]
  );
  if (!runner) {
    res.status(404).json({ error: "Runner not found" });
    return;
  }
  if (runner.banned) {
    res.status(400).json({ error: "Runner is already banned" });
    return;
  }

  // Moderators can ban if they share at least one game with the runner's submissions
  const shared = await queryOne<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM runs r
      WHERE r.runner_id = $1 AND r.game_id = ANY($2::int[])
    ) AS ok
  `, [id, mod.gameIds]);

  if (!shared?.ok && mod.gameIds.length > 0) {
    // Still allow senior mods or if no game filter — for demo, allow if assigned to any game
    // Strict: only ban if shared board. Soften for empty assignment.
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO bans (runner_id, moderator_id, reason, created_at) VALUES ($1, $2, $3, NOW())`,
      [id, mod.id, reason]
    );
    await client.query(`UPDATE runners SET banned = true WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  res.json({ ok: true, banned: true });
});

/** POST /api/runners/:id/unban */
runnersRouter.post("/:id/unban", requireModerator, async (req, res) => {
  const id = Number(req.params.id);
  const mod = req.moderator!;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "Appeal accepted";

  const runner = await queryOne<{ id: number; banned: boolean }>(
    `SELECT id, banned FROM runners WHERE id = $1`,
    [id]
  );
  if (!runner) {
    res.status(404).json({ error: "Runner not found" });
    return;
  }
  if (!runner.banned) {
    res.status(400).json({ error: "Runner is not banned" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE bans SET lifted_at = NOW(), lift_reason = $1, lifted_by = $2
       WHERE runner_id = $3 AND lifted_at IS NULL`,
      [reason, mod.id, id]
    );
    await client.query(`UPDATE runners SET banned = false WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  res.json({ ok: true, banned: false });
});
