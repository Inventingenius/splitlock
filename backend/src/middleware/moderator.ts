import type { Request, Response, NextFunction } from "express";
import { queryOne } from "../db/pool.js";

export interface Moderator {
  id: string;
  name: string;
  handle: string;
  title: string;
  gameIds: number[];
}

declare global {
  namespace Express {
    interface Request {
      moderator?: Moderator;
    }
  }
}

/**
 * Identify the current moderator via `X-Moderator-Id` header.
 * No real login system — per the project brief.
 */
export async function requireModerator(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const id = req.header("x-moderator-id");
  if (!id) {
    res.status(401).json({ error: "Missing X-Moderator-Id header" });
    return;
  }

  const mod = await queryOne<{
    id: string;
    name: string;
    handle: string;
    title: string;
  }>(`SELECT id, name, handle, title FROM moderators WHERE id = $1`, [id]);

  if (!mod) {
    res.status(401).json({ error: `Unknown moderator: ${id}` });
    return;
  }

  const games = await queryOne<{ ids: number[] }>(
    `SELECT COALESCE(array_agg(game_id), '{}') AS ids
     FROM moderator_games WHERE moderator_id = $1`,
    [id]
  );

  req.moderator = {
    ...mod,
    gameIds: games?.ids ?? [],
  };
  next();
}

/** Optional moderator — attaches if header present, does not 401. */
export async function optionalModerator(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const id = req.header("x-moderator-id");
  if (!id) {
    next();
    return;
  }
  const mod = await queryOne<{
    id: string;
    name: string;
    handle: string;
    title: string;
  }>(`SELECT id, name, handle, title FROM moderators WHERE id = $1`, [id]);
  if (mod) {
    const games = await queryOne<{ ids: number[] }>(
      `SELECT COALESCE(array_agg(game_id), '{}') AS ids
       FROM moderator_games WHERE moderator_id = $1`,
      [id]
    );
    req.moderator = { ...mod, gameIds: games?.ids ?? [] };
  }
  next();
}

export function canModerateGame(mod: Moderator, gameId: number): boolean {
  return mod.gameIds.includes(gameId);
}
