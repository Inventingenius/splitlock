import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type QueueResult } from "../lib/api";
import { formatTime, formatDateTime } from "../lib/format";

export function QueuePage() {
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get("page") || 1);
  const assignedOnly = search.get("assignedOnly") !== "false";
  const q = search.get("q") || undefined;

  const [data, setData] = useState<QueueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState(q || "");
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  function reload() {
    setData(null);
    api
      .queue({ page, pageSize: 25, assignedOnly, q })
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, assignedOnly, q]);

  function update(params: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) next.set(k, v);
      else next.delete(k);
    });
    setSearch(next);
  }

  async function onApprove(id: number) {
    setBusy(id);
    try {
      await api.approve(id);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onReject() {
    if (rejectId == null || rejectNote.trim().length < 3) return;
    setBusy(rejectId);
    try {
      await api.reject(rejectId, rejectNote.trim());
      setRejectId(null);
      setRejectNote("");
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="loading">Loading queue…</div>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div>
      <p className="eyebrow">Queue</p>
      <h1>Pending verification</h1>
      <p className="sub">
        {data.total.toLocaleString()} waiting
        {assignedOnly ? " on your assigned boards" : " across the site"}. Highest
        suspicion first.
      </p>

      <div className="toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={assignedOnly}
            onChange={(e) =>
              update({ assignedOnly: e.target.checked ? undefined : "false", page: undefined })
            }
          />
          Assigned boards only
        </label>
        <input
          className="input"
          placeholder="Search runner or game…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") update({ q: qInput || undefined, page: undefined });
          }}
        />
        <button className="btn" onClick={() => update({ q: qInput || undefined, page: undefined })}>
          Search
        </button>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Score</th>
                <th>Runner</th>
                <th>Game / Category</th>
                <th>Time</th>
                <th>Submitted</th>
                <th>Flags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    Queue is empty. Nice work.
                  </td>
                </tr>
              )}
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {item.suspicion.score}
                  </td>
                  <td>
                    <Link to={`/runners/${item.runner.id}`}>{item.runner.name}</Link>
                  </td>
                  <td>
                    <Link to={`/games/${item.game.slug}`}>{item.game.name}</Link>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {item.category.name}
                    </div>
                  </td>
                  <td className="time">
                    <Link to={`/runs/${item.id}`}>{formatTime(item.timeMs)}</Link>
                  </td>
                  <td style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    {formatDateTime(item.submittedAt)}
                  </td>
                  <td>
                    {item.suspicion.flags.slice(0, 2).map((f) => (
                      <span
                        key={f.code}
                        className={`badge badge-${f.severity === "crit" ? "rejected" : f.severity === "warn" ? "pending" : "verified"}`}
                        style={{ marginRight: 4 }}
                        title={f.detail}
                      >
                        {f.label}
                      </span>
                    ))}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn-sm btn-success"
                      disabled={busy === item.id}
                      onClick={() => onApprove(item.id)}
                    >
                      Approve
                    </button>{" "}
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy === item.id}
                      onClick={() => {
                        setRejectId(item.id);
                        setRejectNote("");
                      }}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="pager">
            <button
              className="btn btn-sm"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              Prev
            </button>
            <span>
              Page {page} / {pages}
            </span>
            <button
              className="btn btn-sm"
              disabled={page >= pages}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {rejectId != null && (
        <div className="overlay" onClick={() => setRejectId(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Reject run #{rejectId}</h2>
            <p>Provide a reason. This is shown to the runner and stored in the review history.</p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="e.g. Missing segment at 12:40, video incomplete…"
              autoFocus
            />
            <div className="dialog-actions">
              <button className="btn" onClick={() => setRejectId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={rejectNote.trim().length < 3 || busy === rejectId}
                onClick={onReject}
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
