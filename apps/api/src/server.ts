import cors from "cors";
import "dotenv/config";
import express from "express";
import { z } from "zod";
import {
  ApiError,
  createDailySession,
  createRandomSession,
  getPublicSession,
  searchCharacterRows,
  submitGuess,
} from "./game";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "touhoufriberg-api" });
});

app.get("/api/characters/search", async (req, res, next) => {
  try {
    const query = z.string().optional().parse(req.query.q);
    res.json({ results: await searchCharacterRows(query ?? "") });
  } catch (error) {
    next(error);
  }
});

app.get("/api/puzzles/daily", async (req, res, next) => {
  try {
    const dateKey = z.string().optional().parse(req.query.date);
    res.json({
      puzzleLabel: dateKey ? `每日题 ${dateKey}` : "今日每日题",
      session: await createDailySession(dateKey),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/puzzles/daily/guess", async (req, res, next) => {
  try {
    const body = z
      .object({ sessionId: z.string(), characterId: z.string() })
      .parse(req.body);
    res.json({ session: await submitGuess(body.sessionId, body.characterId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/puzzles/random", async (_req, res, next) => {
  try {
    res.json({ puzzleLabel: "随机题", session: await createRandomSession() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:sessionId/guess", async (req, res, next) => {
  try {
    const params = z.object({ sessionId: z.string() }).parse(req.params);
    const body = z.object({ characterId: z.string() }).parse(req.body);
    res.json({
      session: await submitGuess(params.sessionId, body.characterId),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:sessionId", async (req, res, next) => {
  try {
    const params = z.object({ sessionId: z.string() }).parse(req.params);
    res.json({ session: await getPublicSession(params.sessionId) });
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "请求格式不正确。", details: error.issues });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "服务器暂时无法处理请求。" });
  },
);

app.listen(port, () => {
  console.log(`TouhouFlandre API listening on http://localhost:${port}`);
});
