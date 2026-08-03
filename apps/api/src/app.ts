import cors from "cors";
import express from "express";
import { z } from "zod";
import {
  CHARACTER_SORTS,
  SINGLE_PLAYER_GAME_MODES,
  SORT_DIRECTIONS,
} from "@touhoufriberg/shared";
import {
  ApiError,
  createPuzzleSession,
  getCatalogSummary,
  getPublicSession,
  searchCharacterRows,
  submitGuess,
} from "./game";

export const createApp = () => {
  const app = express();
  const allowedOrigins = new Set(
    (process.env.WEB_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || allowedOrigins.has(origin)),
    }),
  );
  app.use(express.json({ limit: "32kb" }));

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
        .max(250)
        .optional()
        .parse(req.query.limit);
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .parse(req.query.offset);
      const sort = z.enum(CHARACTER_SORTS).optional().parse(req.query.sort);
      const direction = z
        .enum(SORT_DIRECTIONS)
        .optional()
        .parse(req.query.direction);
      res.json(
        await searchCharacterRows(query ?? "", {
          limit,
          offset,
          sort,
          direction,
        }),
      );
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
      res.json(await createPuzzleSession(params.mode));
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

  return app;
};
