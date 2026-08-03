import cors from "cors";
import "dotenv/config";
import express from "express";
import { z } from "zod";
import {
  ApiError,
  createPuzzleSession,
  getCatalogSummary,
  getPublicSession,
  searchCharacterRows,
  submitGuess,
} from "./game";
import { SINGLE_PLAYER_GAME_MODES } from "@touhoufriberg/shared";

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
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .parse(req.query.limit);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .parse(req.query.offset);
    res.json(await searchCharacterRows(query ?? "", { limit, offset }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/catalog", async (_req, res, next) => {
  try {
    res.json(await getCatalogSummary());
  } catch (error) {
    next(error);
  }
});

app.post("/api/puzzles/:mode", async (req, res, next) => {
  try {
    const params = z
      .object({ mode: z.enum(SINGLE_PLAYER_GAME_MODES) })
      .parse(req.params);
    const body = z
      .object({ dateKey: z.string().optional() })
      .parse(req.body ?? {});
    res.json(await createPuzzleSession(params.mode, body.dateKey));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:sessionId/guess", async (req, res, next) => {
  try {
    const params = z.object({ sessionId: z.string() }).parse(req.params);
    const body = z.object({ guessId: z.string() }).parse(req.body);
    res.json({
      session: await submitGuess(params.sessionId, body.guessId),
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
