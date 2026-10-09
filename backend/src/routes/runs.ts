import { Router } from "express";
import { query, queryOne } from "../db/pool.js";
import { requireModerator, canModerateGame } from "../middleware/moderator.js";
import {
  computeSuspicion,
  suspicionScore,
  FRAME_TOLERANCE_MS,
} from "../utils/suspicion.js";

export const runsRouter = Router();

/** GET /api/runs/:id — full run detail + splits + review history + suspicion */
runsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }

  const run = await queryOne<{
    id: number;
    game_id: number;
    category_id: number;
    runner_id: number;
    time_ms: number;
    status: string;
    platform: string;
    emulator: boolean;
    video_url: string | null;
    comment: string | null;
    submitted_at: string;
    verified_at: string | null;
    game_name: string;
    game_slug: string;
    game_platform: string;
    category_name: string;
    category_slug: string;
    runner_name: string;
    runner_country: string;
    runner_banned: boolean;
  }>(`
    SELECT r.*,
           g.name AS game_name, g.slug AS game_slug, g.platform AS game_platform,
           c.name AS category_name, c.slug AS category_slug,
           rn.name AS runner_name, rn.country AS runner_country, rn.banned AS runner_banned
    FROM runs r
    JOIN games g ON g.id = r.game_id
    JOIN categories c ON c.id = r.category_id
    JOIN runners rn ON rn.id = r.runner_id
    WHERE r.id = $1
  `, [id]);

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const splits = await query<{
    checkpoint: string;
    time_ms: number;
    order_index: number;
  }>(`
    SELECT checkpoint, time_ms, order_index
    FROM splits WHERE run_id = $1 ORDER BY order_index
  `, [id]);

  const reviews = await query<{
    id: number;
    action: string;
    note: string | null;
    created_at: string;
    moderator_id: string | null;
    moderator_name: string | null;
    moderator_handle: string | null;
  }>(`
    SELECT rv.id, rv.action, rv.note, rv.created_at,
           rv.moderator_id, m.name AS moderator_name, m.handle AS moderator_handle
    FROM reviews rv
    LEFT JOIN moderators m ON m.id = rv.moderator_id
    WHERE rv.run_id = $1
    ORDER BY rv.created_at ASC
  `, [id]);

  // Suspicion inputs
  const wr = await queryOne<{ wr_ms: number }>(`
    SELECT MIN(r.time_ms) AS wr_ms
    FROM runs r
    JOIN runners rn ON rn.id = r.runner_id
    WHERE r.category_id = $1 AND r.status = 'verified' AND rn.banned = false
  `, [run.category_id]);

  const prevPb = await queryOne<{ pb_ms: number }>(`
    SELECT MIN(time_ms) AS pb_ms
    FROM runs
    WHERE category_id = $1 AND runner_id = $2 AND status = 'verified' AND id <> $3
  `, [run.category_id, run.runner_id, id]);

  // Frame-clone probe: any other verified time within one NTSC frame.
  const clone = await queryOne<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt
    FROM runs
    WHERE category_id = $1 AND status = 'verified' AND id <> $2
      AND ABS(time_ms - $3) <= $4
  `, [run.category_id, id, run.time_ms, FRAME_TOLERANCE_MS]);

  const rejected = await queryOne<{ cnt: string }>(`
    SELECT COUNT(*) AS cnt FROM runs
    WHERE runner_id = $1 AND status = 'rejected'
  `, [run.runner_id]);

  const flags = computeSuspicion({
    timeMs: run.time_ms,
    wrMs: wr?.wr_ms ?? null,
    prevPbMs: prevPb?.pb_ms ?? null,
    cloneCount: Number(clone?.cnt ?? 0),
    emulator: run.emulator,
    platform: run.platform,
    gamePlatform: run.game_platform,
    rejectedCount: Number(rejected?.cnt ?? 0),
    videoUrl: run.video_url,
    comment: run.comment,
  });

  res.json({
    id: run.id,
    timeMs: run.time_ms,
    status: run.status,
    platform: run.platform,
    emulator: run.emulator,
    videoUrl: run.video_url,
    comment: run.comment,
    submittedAt: run.submitted_at,
    verifiedAt: run.verified_at,
    game: {
      id: run.game_id,
      name: run.game_name,
      slug: run.game_slug,
      platform: run.game_platform,
    },
    category: {
      id: run.category_id,
      name: run.category_name,
      slug: run.category_slug,
    },
    runner: {
      id: run.runner_id,
      name: run.runner_name,
      country: run.runner_country,
      banned: run.runner_banned,
    },
    splits: splits.map((s) => ({
      checkpoint: s.checkpoint,
      timeMs: s.time_ms,
      orderIndex: s.order_index,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      action: r.action,
      note: r.note,
      createdAt: r.created_at,
      moderator: r.moderator_id
        ? { id: r.moderator_id, name: r.moderator_name, handle: r.moderator_handle }
        : null,
    })),
    suspicion: {
      score: suspicionScore(flags),
      flags,
    },
  });
});

/** POST /api/runs/:id/approve */
runsRouter.post("/:id/approve", requireModerator, async (req, res) => {
  const id = Number(req.params.id);
  const mod = req.moderator!;
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  const run = await queryOne<{ id: number; game_id: number; status: string }>(
    `SELECT id, game_id, status FROM runs WHERE id = $1`,
    [id]
  );
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (!canModerateGame(mod, run.game_id)) {
    res.status(403).json({ error: "You are not assigned to this game" });
    return;
  }
  if (run.status !== "pending" && run.status !== "rejected") {
    res.status(400).json({ error: `Cannot approve a run with status ${run.status}` });
    return;
  }

  await query(`UPDATE runs SET status = 'verified', verified_at = NOW() WHERE id = $1`, [id]);
  await query(
    `INSERT INTO reviews (run_id, moderator_id, action, note, created_at)
     VALUES ($1, $2, 'approved', $3, NOW())`,
    [id, mod.id, note]
  );

  res.json({ ok: true, status: "verified" });
});

/** POST /api/runs/:id/reject */
runsRouter.post("/:id/reject", requireModerator, async (req, res) => {
  const id = Number(req.params.id);
  const mod = req.moderator!;
  const note = typeof req.body?.note === "string" ? req.body.note : null;
  if (!note || note.trim().length < 3) {
    res.status(400).json({ error: "A rejection note is required (min 3 chars)" });
    return;
  }

  const run = await queryOne<{ id: number; game_id: number; status: string }>(
    `SELECT id, game_id, status FROM runs WHERE id = $1`,
    [id]
  );
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (!canModerateGame(mod, run.game_id)) {
    res.status(403).json({ error: "You are not assigned to this game" });
    return;
  }
  if (run.status !== "pending" && run.status !== "verified") {
    res.status(400).json({ error: `Cannot reject a run with status ${run.status}` });
    return;
  }

  await query(`UPDATE runs SET status = 'rejected', verified_at = NULL WHERE id = $1`, [id]);
  await query(
    `INSERT INTO reviews (run_id, moderator_id, action, note, created_at)
     VALUES ($1, $2, 'rejected', $3, NOW())`,
    [id, mod.id, note.trim()]
  );

  res.json({ ok: true, status: "rejected" });
});

/** POST /api/runs/:id/reopen */
runsRouter.post("/:id/reopen", requireModerator, async (req, res) => {
  const id = Number(req.params.id);
  const mod = req.moderator!;
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  const run = await queryOne<{ id: number; game_id: number; status: string }>(
    `SELECT id, game_id, status FROM runs WHERE id = $1`,
    [id]
  );
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (!canModerateGame(mod, run.game_id)) {
    res.status(403).json({ error: "You are not assigned to this game" });
    return;
  }
  if (run.status === "pending") {
    res.status(400).json({ error: "Run is already pending" });
    return;
  }

  await query(`UPDATE runs SET status = 'pending', verified_at = NULL WHERE id = $1`, [id]);
  await query(
    `INSERT INTO reviews (run_id, moderator_id, action, note, created_at)
     VALUES ($1, $2, 'reopened', $3, NOW())`,
    [id, mod.id, note]
  );

  res.json({ ok: true, status: "pending" });
});
