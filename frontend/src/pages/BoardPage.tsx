import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Leaderboard } from "../lib/api";
import { formatTime, formatDelta, formatDate, downloadCsv } from "../lib/format";

export function BoardPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useSearchParams();
  const cat = search.get("cat") || undefined;
  const q = search.get("q") || undefined;
  const platform = search.get("platform") || undefined;
  const page = Number(search.get("page") || 1);

  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState(q || "");

  useEffect(() => {
    if (!slug) return;
    setData(null);
    api
      .leaderboard(slug, { cat, q, platform, page, pageSize: 50 })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [slug, cat, q, platform, page]);

  function update(params: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    Object.entries(params).forEach(([k, v]) => {
      if (v) next.set(k, v);
      else next.delete(k);
    });
    if (!params.page) next.delete("page");
    setSearch(next);
  }

  async function onExport() {
    if (!slug) return;
    const csv = await api.exportLeaderboard(slug, { cat, q, platform });
    downloadCsv(csv, `${slug}-leaderboard.csv`);
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="loading">Loading leaderboard…</div>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div>
      <p className="eyebrow">{data.game.platform}</p>
      <h1>{data.game.name}</h1>
      <p className="sub">
        {data.category.name} · {data.total.toLocaleString()} ranked runners
      </p>

      <div className="toolbar">
        <select
          className="select"
          style={{ maxWidth: 200 }}
          value={data.category.slug}
          onChange={(e) => update({ cat: e.target.value })}
        >
          {data.categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Search runner…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") update({ q: qInput || undefined });
          }}
        />
        <button className="btn" onClick={() => update({ q: qInput || undefined })}>
          Search
        </button>
        <select
          className="select"
          style={{ maxWidth: 140 }}
          value={platform || ""}
          onChange={(e) => update({ platform: e.target.value || undefined })}
        >
          <option value="">All platforms</option>
          <option value={data.game.platform}>{data.game.platform}</option>
          <option value="Emulator">Emulator</option>
          <option value="PC">PC</option>
        </select>
        <button className="btn" onClick={onExport}>
          Export CSV
        </button>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Runner</th>
                <th>Time</th>
                <th>Delta</th>
                <th>Platform</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No verified runs match these filters.
                  </td>
                </tr>
              )}
              {data.entries.map((e) => (
                <tr key={e.runId}>
                  <td className="rank">{e.rank}</td>
                  <td>
                    <Link to={`/runners/${e.runner.id}`}>{e.runner.name}</Link>
                    <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: "0.8rem" }}>
                      {e.runner.country}
                    </span>
                  </td>
                  <td className="time">
                    <Link to={`/runs/${e.runId}`}>{formatTime(e.timeMs)}</Link>
                  </td>
                  <td className="delta">{formatDelta(e.deltaMs)}</td>
                  <td>
                    {e.platform}
                    {e.emulator ? " (emu)" : ""}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    {formatDate(e.submittedAt)}
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
    </div>
  );
}
