import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type GameSummary } from "../lib/api";

export function HomePage() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .games()
      .then(setGames)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!games) return <div className="loading">Loading games…</div>;

  return (
    <div>
      <p className="eyebrow">Splitlock</p>
      <h1>Moderation boards</h1>
      <p className="sub">
        Browse leaderboards, review pending submissions, and manage bans.
        Identify yourself with the moderator switcher in the header.
      </p>
      <div className="game-grid">
        {games.map((g) => (
          <Link key={g.id} to={`/games/${g.slug}`} className="game-card">
            <div
              className="hue"
              style={{ background: `hsl(${g.hue} 70% 50%)` }}
            />
            <h3>{g.name}</h3>
            <div className="meta">
              {g.platform} · {g.year} · {g.genre}
            </div>
            <div className="stats">
              <span>{g.verified_count.toLocaleString()} verified</span>
              <span>{g.pending_count.toLocaleString()} pending</span>
              <span>{g.category_count} cats</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
