import express from "express";
import cors from "cors";
import { pool } from "./db/pool.js";
const app = express();
const PORT = Number(process.env.PORT) || 4000;
app.use(cors());
app.use(express.json());
app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true }); }
  catch (e) { res.status(503).json({ ok: false, error: String(e) }); }
});
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
app.listen(PORT, "0.0.0.0", () => console.log(`Splitlock API listening on :${PORT}`));
