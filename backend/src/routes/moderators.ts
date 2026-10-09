import { Router } from "express";
import { query, queryOne } from "../db/pool.js";
import { optionalModerator } from "../middleware/moderator.js";

export const moderatorsRouter = Router();

/** GET /api/moderators — list all moderators (for the header switcher) */
moderatorsRouter.get("/", async (_req, res) => {
  const mods = await query<{
    id: string;
    name: string;
    handle: string;
    title: string;
  }>(`SELECT id, name, handle, title FROM moderators ORDER BY name`);

  const withGames = await Promise.all(
    mods.map(async (m) => {
      const games = await query<{ id: number; name: string; slug: string }>(`
        SELECT g.id, g.name, g.slug
        FROM moderator_games mg
        JOIN games g ON g.id = mg.game_id
        WHERE mg.moderator_id = $1
        ORDER BY g.name
      `, [m.id]);
      return { ...m, games };
    })
  );

  res.json(withGames);
});

/** GET /api/moderators/me — current moderator from header */
moderatorsRouter.get("/me", optionalModerator, async (req, res) => {
  if (!req.moderator) {
    res.status(401).json({ error: "Not identified" });
    return;
  }
  const games = await query<{ id: number; name: string; slug: string }>(`
    SELECT g.id, g.name, g.slug
    FROM moderator_games mg
    JOIN games g ON g.id = mg.game_id
    WHERE mg.moderator_id = $1
    ORDER BY g.name
  `, [req.moderator.id]);

  res.json({ ...req.moderator, games });
});
