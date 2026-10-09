import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, getModeratorId, setModeratorId, type Moderator } from "./lib/api";
import { HomePage } from "./pages/HomePage";
import { BoardPage } from "./pages/BoardPage";
import { QueuePage } from "./pages/QueuePage";
import { RunPage } from "./pages/RunPage";
import { RunnerPage } from "./pages/RunnerPage";

export function App() {
  const [mods, setMods] = useState<Moderator[]>([]);
  const [modId, setModId] = useState(getModeratorId());

  useEffect(() => {
    api.moderators().then(setMods).catch(console.error);
  }, []);

  function onModChange(id: string) {
    setModeratorId(id);
    setModId(id);
    // Reload so queue / permission-scoped views refresh for the new moderator
    window.location.reload();
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="logo">
          Split<span>lock</span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Games
          </NavLink>
          <NavLink to="/queue">Queue</NavLink>
        </nav>
        <div className="mod-switcher">
          <span>Moderator</span>
          <select value={modId} onChange={(e) => onModChange(e.target.value)}>
            {mods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.handle})
              </option>
            ))}
          </select>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/games/:slug" element={<BoardPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="/runners/:id" element={<RunnerPage />} />
        </Routes>
      </main>
    </div>
  );
}
