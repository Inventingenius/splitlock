import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type RunnerDetail } from "../lib/api";
import { formatTime, formatDate, formatDateTime } from "../lib/format";

export function RunnerPage() {
  const { id } = useParams<{ id: string }>();
  const [runner, setRunner] = useState<RunnerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [reason, setReason] = useState("");

  function load() {
    if (!id) return;
    setRunner(null);
    api
      .runner(Number(id))
      .then(setRunner)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function onBan() {
    if (!runner || reason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.ban(runner.id, reason.trim());
      setBanOpen(false);
      setReason("");
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onUnban() {
    if (!runner) return;
    setBusy(true);
    try {
      await api.unban(runner.id, "Appeal accepted");
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!runner) return <div className="loading">Loading runner…</div>;

  return (
    <div>
      <p className="eyebrow">{runner.country}</p>
      <h1>
        {runner.name}{" "}
        {runner.banned && <span className="badge badge-banned">banned</span>}
      </h1>
      <p className="sub">
        Joined {formatDate(runner.joinedAt)} · {runner.stats.total} runs (
        {runner.stats.verified} verified, {runner.stats.pending} pending,{" "}
        {runner.stats.rejected} rejected)
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem" }}>
        {runner.banned ? (
          <button className="btn btn-success" disabled={busy} onClick={onUnban}>
            Lift ban
          </button>
        ) : (
          <button className="btn btn-danger" disabled={busy} onClick={() => setBanOpen(true)}>
            Ban runner
          </button>
        )}
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-header">Recent runs</div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Category</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {runner.runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/games/${r.game.slug}`}>{r.game.name}</Link>
                    </td>
                    <td>{r.category.name}</td>
                    <td className="time">
                      <Link to={`/runs/${r.id}`}>{formatTime(r.timeMs)}</Link>
                    </td>
                    <td>
                      <span className={`badge badge-${r.status}`}>{r.status}</span>
                    </td>
                    <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      {formatDate(r.submittedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Ban history</div>
          <div style={{ padding: "0.75rem 1rem" }}>
            {runner.bans.length === 0 && <div className="empty">No bans on record.</div>}
            {runner.bans.map((b) => (
              <div
                key={b.id}
                style={{
                  marginBottom: "0.75rem",
                  paddingBottom: "0.75rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{b.reason}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
                  by {b.moderatorName} · {formatDateTime(b.createdAt)}
                </div>
                {b.liftedAt && (
                  <div style={{ fontSize: "0.85rem", color: "var(--success)", marginTop: 4 }}>
                    Lifted {formatDateTime(b.liftedAt)}
                    {b.liftedByName ? ` by ${b.liftedByName}` : ""}
                    {b.liftReason ? ` — ${b.liftReason}` : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {banOpen && (
        <div className="overlay" onClick={() => setBanOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Ban {runner.name}</h2>
            <p>
              Banning removes all of this runner&apos;s times from leaderboards. The ban is
              reversible.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for the ban…"
              autoFocus
            />
            <div className="dialog-actions">
              <button className="btn" onClick={() => setBanOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={reason.trim().length < 5 || busy}
                onClick={onBan}
              >
                Ban
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
