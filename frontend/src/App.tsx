import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, getModeratorId, setModeratorId, type Moderator } from "./lib/api";

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <p className="eyebrow">Splitlock</p>
      <h1>{title}</h1>
      <p className="sub">Coming online…</p>
    </div>
  );
}

export function App() {
  const [mods, setMods] = useState<Moderator[]>([]);
  const [modId, setModId] = useState(getModeratorId());
  useEffect(() => { api.moderators().then(setMods).catch(console.error); }, []);
  function onModChange(id: string) {
    setModeratorId(id);
    setModId(id);
    window.location.reload();
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="logo">Split<span>lock</span></NavLink>
        <nav className="nav">
          <NavLink to="/" end>Games</NavLink>
          <NavLink to="/queue">Queue</NavLink>
        </nav>
        <div className="mod-switcher">
          <span>Moderator</span>
          <select value={modId} onChange={(e) => onModChange(e.target.value)}>
            {mods.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.handle})</option>
            ))}
          </select>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Placeholder title="Games" />} />
          <Route path="/queue" element={<Placeholder title="Queue" />} />
        </Routes>
      </main>
    </div>
  );
}
