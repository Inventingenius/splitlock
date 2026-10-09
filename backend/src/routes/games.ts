import { Router } from "express";
import { query, queryOne } from "../db/pool.js";

export const gamesRouter = Router();

gamesRouter.get("/", async (_req, res) => {
  const games = await query<{
    id: number;
    slug: string;
    name: string;
    short_name: string;
    year: number;
    platform: string;
    genre: string;
    hue: number;
    category_count: string;
    verified_count: string;
    pending_count: string;
  }>(`
    SELECT g.*,
           (SELECT COUNT(*) FROM categories c WHERE c.game_id = g.id) AS category_count,
           (SELECT COUNT(*) FROM runs r WHERE r.game_id = g.id AND r.status = 'verified') AS verified_count,
           (SELECT COUNT(*) FROM runs r WHERE r.game_id = g.id AND r.status = 'pending') AS pending_count
    FROM games g
    ORDER BY g.name
  `);
  res.json(
    games.map((g) => ({
      ...g,
      category_count: Number(g.category_count),
      verified_count: Number(g.verified_count),
      pending_count: Number(g.pending_count),
    }))
  );
});

gamesRouter.get("/:slug", async (req, res) => {
  const game = await queryOne(`
    SELECT * FROM games WHERE slug = $1
  `, [req.params.slug]);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const categories = await query(`
    SELECT c.*,
           (SELECT COUNT(*) FROM runs r WHERE r.category_id = c.id AND r.status = 'verified') AS verified_count,
           (SELECT MIN(r.time_ms) FROM runs r
              JOIN runners rn ON rn.id = r.runner_id
             WHERE r.category_id = c.id AND r.status = 'verified' AND rn.banned = false) AS wr_ms
    FROM categories c
    WHERE c.game_id = $1
    ORDER BY c.name
  `, [(game as { id: number }).id]);

  res.json({
    ...game,
    categories: categories.map((c: Record<string, unknown>) => ({
      ...c,
      verified_count: Number(c.verified_count),
      wr_ms: c.wr_ms != null ? Number(c.wr_ms) : null,
    })),
  });
});
