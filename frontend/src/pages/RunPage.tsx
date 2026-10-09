import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type RunDetail } from "../lib/api";
import { formatTime, formatDateTime } from "../lib/format";

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  function load() {
    if (!id) return;
    setRun(null);
    api
      .run(Number(id))
      .then(setRun)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function act(action: "approve" | "reject" | "reopen") {
    if (!run) return;
    setBusy(true);
    try {
      if (action === "approve") await api.approve(run.id, note || undefined);
      else if (action === "reject") await api.reject(run.id, note);
      else await api.reopen(run.id, note || undefined);
      setRejectOpen(false);
      setNote("");
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!run) return <div className="loading">Loading run…</div>;

  return (
    <div>
      <p className="eyebrow">
        <Link to={`/games/${run.game.slug}`}>{run.game.name}</Link> · {run.category.name}
      </p>
      <h1>
        <span className="mono">{formatTime(run.timeMs)}</span>{" "}
        <span className={`badge badge-${run.status}`}>{run.status}</span>
      </h1>
      <p className="sub">
        by <Link to={`/runners/${run.runner.id}`}>{run.runner.name}</Link>
        {run.runner.banned && (
          <span className="badge badge-banned" style={{ marginLeft: 8 }}>
            banned
          </span>
        )}
        {" · "}
        submitted {formatDateTime(run.submittedAt)}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {(run.status === "pending" || run.status === "rejected") && (
          <button className="btn btn-success" disabled={busy} onClick={() => act("approve")}>
            Approve
          </button>
        )}
        {(run.status === "pending" || run.status === "verified") && (
          <button className="btn btn-danger" disabled={busy} onClick={() => setRejectOpen(true)}>
            Reject
          </button>
        )}
        {run.status !== "pending" && (
          <button className="btn" disabled={busy} onClick={() => act("reopen")}>
            Reopen
          </button>
        )}
        {run.videoUrl && (
          <a className="btn" href={run.videoUrl} target="_blank" rel="noreferrer">
            Open VOD
          </a>
        )}
      </div>

      <div className="two-col">
        <div>
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <div className="panel-header">Details</div>
            <div style={{ padding: "0.75rem 1rem", fontSize: "0.9rem" }}>
              <Row label="Platform" value={`${run.platform}${run.emulator ? " (emulator)" : ""}`} />
              <Row label="Video" value={run.videoUrl ? "Present" : "Missing"} />
              <Row label="Comment" value={run.comment || "—"} />
              <Row label="Verified" value={run.verifiedAt ? formatDateTime(run.verifiedAt) : "—"} />
            </div>
          </div>

          <div className="panel" style={{ marginBottom: "1rem" }}>
            <div className="panel-header">Suspicion · score {run.suspicion.score}</div>
            <div style={{ padding: "0.75rem" }}>
              {run.suspicion.flags.length === 0 && (
                <div className="empty" style={{ padding: "1rem" }}>
                  No flags raised.
                </div>
              )}
              {run.suspicion.flags.map((f) => (
                <div key={f.code} className={`flag flag-${f.severity}`}>
                  <span className="flag-label">{f.label}</span>
                  <span style={{ color: "var(--text-dim)" }}>{f.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <div className="panel-header">Checkpoint times</div>
            <div style={{ padding: "0.5rem 1rem" }}>
              {run.splits.length === 0 ? (
                <div className="empty">No splits recorded.</div>
              ) : (
                <ul className="splits">
                  {run.splits.map((s) => (
                    <li key={s.orderIndex}>
                      <span className="cp">{s.checkpoint}</span>
                      <span className="t">{formatTime(s.timeMs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">Review history</div>
            <div style={{ padding: "0.5rem 1rem" }}>
              <ul className="timeline">
                {run.reviews.map((r) => (
                  <li key={r.id}>
                    <div>
                      <span className="action">{r.action}</span>
                      {r.moderator && (
                        <span style={{ color: "var(--text-dim)" }}> by {r.moderator.name}</span>
                      )}
                    </div>
                    {r.note && (
                      <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>{r.note}</div>
                    )}
                    <div className="when">{formatDateTime(r.createdAt)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {rejectOpen && (
        <div className="overlay" onClick={() => setRejectOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Reject run</h2>
            <p>Reason is required and will be stored in the review history.</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this run being rejected?"
              autoFocus
            />
            <div className="dialog-actions">
              <button className="btn" onClick={() => setRejectOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={note.trim().length < 3 || busy}
                onClick={() => act("reject")}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "0.35rem 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
