import express, { type NextFunction, type Request, type Response } from "express";
import { bearerToken, defaultDisplayName, type AuthUser, type AuthVerifier } from "./auth.ts";
import type { CanonService } from "./canon.ts";
import {
  CONTENT_MODES,
  MODERATION_POLICIES,
  PROMPT_RATINGS,
  PROMPT_STATUSES,
  type ModerationPolicy,
  type PartyDb,
  type Prompt,
  type PromptInput,
  type PromptRating,
  type PromptStatus,
} from "./db.ts";
import { toClientError, PartyError, type ErrorCode } from "./errors.ts";
import { gameSummaries } from "./games/registry.ts";
import { RateLimiter } from "./ratelimit.ts";
import { cleanName, cleanTags, cleanText, LIMITS } from "./text.ts";

export interface ApiDeps {
  db: PartyDb;
  auth: AuthVerifier;
  canon: CanonService;
  firebase: { apiKey: string; authDomain: string; projectId: string } | null;
}

const STATUS_BY_ERROR: Partial<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  AUTH_FAILED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  AUTH_DISABLED: 404,
  RATE_LIMITED: 429,
  SERVER_BUSY: 503,
  SERVER_ERROR: 500,
};

function user(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

function body(req: Request): Record<string, unknown> {
  const b: unknown = req.body;
  if (typeof b !== "object" || b === null || Array.isArray(b)) throw new PartyError("INVALID_INPUT");
  return b as Record<string, unknown>;
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new PartyError("NOT_FOUND");
  return id;
}

function publicPrompt(p: Prompt, viewerUid: string, moderator: boolean) {
  const mine = p.authorUid === viewerUid;
  return {
    id: p.id,
    text: p.text,
    category: p.category,
    tags: p.tags,
    rating: p.rating,
    author: p.authorUid ? (p.authorName ?? "Unknown agent") : (p.packName ?? "Standard Issue"),
    builtin: p.authorUid === null,
    usageCount: p.usageCount,
    mine,
    // Moderation details are only for the author and moderators.
    ...(mine || moderator
      ? { status: p.status, packId: p.packId, packName: p.packName, createdAt: p.createdAt, updatedAt: p.updatedAt }
      : {}),
    ...(moderator ? { openReports: p.openReports } : {}),
  };
}

export function createApi({ db, auth, canon, firebase }: ApiDeps): express.Router {
  const api = express.Router();
  const writeLimiter = new RateLimiter(30, 10 * 60_000);
  const readLimiter = new RateLimiter(240, 60_000);
  setInterval(() => {
    writeLimiter.prune();
    readLimiter.prune();
  }, 60_000).unref();

  api.use(express.json({ limit: "16kb" }));
  api.use((req, _res, next) => {
    if (!readLimiter.take(req.ip ?? "unknown")) throw new PartyError("RATE_LIMITED");
    next();
  });

  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    if (auth.mode === "none") throw new PartyError("AUTH_DISABLED");
    const token = bearerToken(req.get("authorization"));
    if (!token) throw new PartyError("AUTH_REQUIRED");
    const verified = await auth.verify(token);
    res.locals.user = verified;
    res.locals.displayName = db.ensureProfile(verified.uid, defaultDisplayName(verified.uid));
    next();
  };

  const requireModerator = (_req: Request, res: Response, next: NextFunction) => {
    if (!user(res).isModerator) throw new PartyError("FORBIDDEN");
    next();
  };

  const limitWrites = (_req: Request, res: Response, next: NextFunction) => {
    if (!writeLimiter.take(user(res).uid)) throw new PartyError("RATE_LIMITED");
    next();
  };

  function parsePrompt(input: Record<string, unknown>): PromptInput {
    const text = cleanText(input.text, LIMITS.promptMax, LIMITS.promptMin);
    if (!text.ok) {
      throw new PartyError("INVALID_INPUT", `Prompts must be ${LIMITS.promptMin}–${LIMITS.promptMax} characters.`);
    }
    if (typeof input.category !== "string" || !db.hasCategory(input.category)) {
      throw new PartyError("INVALID_INPUT", "Pick one of the listed categories.");
    }
    const tags = cleanTags(input.tags);
    if (!tags) {
      throw new PartyError("INVALID_INPUT", `Up to ${LIMITS.tagsMax} tags, letters/numbers/dashes, ${LIMITS.tagMax} characters each.`);
    }
    if (!PROMPT_RATINGS.includes(input.rating as PromptRating)) {
      throw new PartyError("INVALID_INPUT", "Rating must be safe or chaos.");
    }
    return { text: text.value, category: input.category, tags, rating: input.rating as PromptRating };
  }

  function loadPrompt(req: Request): Prompt {
    const prompt = db.getPrompt(idParam(req));
    if (!prompt) throw new PartyError("NOT_FOUND");
    return prompt;
  }

  // ------------------------------------------------------------ public

  api.get("/config", (_req, res) => {
    res.json({
      auth: { mode: auth.mode, firebase },
      games: gameSummaries(),
      contentModes: CONTENT_MODES,
      categories: db.listCategories(),
      promptCounts: db.countPlayablePrompts(),
      // Lets the host lobby warn when a canon-driven game has nothing to draw on.
      canonCounts: {
        entity: canon.byKind("entity").length,
        incident: canon.byKind("incident").length,
        personnel: canon.byKind("personnel").length,
      },
      limits: LIMITS,
    });
  });

  // ------------------------------------------------------------ profile & stats

  api.get("/me", requireUser, (_req, res) => {
    const u = user(res);
    res.json({ uid: u.uid, displayName: res.locals.displayName, role: u.role, isModerator: u.isModerator });
  });

  api.put("/me", requireUser, limitWrites, (req, res) => {
    const displayName = cleanName(body(req).displayName);
    if (!displayName) throw new PartyError("INVALID_NAME");
    db.setDisplayName(user(res).uid, displayName);
    res.json({ displayName });
  });

  api.get("/me/stats", requireUser, (_req, res) => {
    res.json(db.getUserStats(user(res).uid));
  });

  api.get("/me/history", requireUser, (_req, res) => {
    res.json(db.getUserHistory(user(res).uid, 25));
  });

  // ------------------------------------------------------------ prompts

  api.get("/prompts/mine", requireUser, (_req, res) => {
    const u = user(res);
    res.json(db.listPromptsByAuthor(u.uid).map((p) => publicPrompt(p, u.uid, u.isModerator)));
  });

  api.get("/prompts/library", requireUser, (req, res) => {
    const u = user(res);
    const rating = PROMPT_RATINGS.includes(req.query.rating as PromptRating) ? (req.query.rating as PromptRating) : undefined;
    const category = typeof req.query.category === "string" && db.hasCategory(req.query.category) ? req.query.category : undefined;
    const search = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : undefined;
    const page = Math.max(0, Math.min(1000, Number.parseInt(String(req.query.page ?? "0"), 10) || 0));
    const prompts = db.listLibrary({ rating, category, search, limit: 50, offset: page * 50 });
    res.json(prompts.map((p) => publicPrompt(p, u.uid, u.isModerator)));
  });

  api.post("/prompts", requireUser, limitWrites, (req, res) => {
    const u = user(res);
    const prompt = db.createPrompt(u.uid, parsePrompt(body(req)));
    res.status(201).json(publicPrompt(prompt, u.uid, u.isModerator));
  });

  api.patch("/prompts/:id", requireUser, limitWrites, (req, res) => {
    const u = user(res);
    const prompt = loadPrompt(req);
    const input = body(req);

    if (u.isModerator) {
      const changes: Parameters<PartyDb["updatePromptAsModerator"]>[1] = {};
      if (["text", "category", "tags", "rating"].some((k) => k in input)) {
        Object.assign(changes, parsePrompt({ ...prompt, ...input }));
      }
      if (input.status !== undefined) {
        if (!PROMPT_STATUSES.includes(input.status as PromptStatus)) throw new PartyError("INVALID_INPUT");
        changes.status = input.status as PromptStatus;
      }
      if (input.packId !== undefined) {
        if (input.packId !== null && !db.listPacks().some((p) => p.id === input.packId)) throw new PartyError("INVALID_INPUT");
        changes.packId = input.packId as number | null;
      }
      res.json(publicPrompt(db.updatePromptAsModerator(prompt.id, changes), u.uid, true));
      return;
    }

    if (prompt.authorUid !== u.uid) throw new PartyError("FORBIDDEN");
    const updated = db.updatePromptAsAuthor(prompt.id, parsePrompt({ ...prompt, ...input }));
    res.json(publicPrompt(updated, u.uid, false));
  });

  api.delete("/prompts/:id", requireUser, limitWrites, (req, res) => {
    const u = user(res);
    const prompt = loadPrompt(req);
    if (prompt.authorUid !== u.uid && !u.isModerator) throw new PartyError("FORBIDDEN");
    db.deletePrompt(prompt.id);
    res.status(204).end();
  });

  api.post("/prompts/:id/report", requireUser, limitWrites, (req, res) => {
    const u = user(res);
    const prompt = loadPrompt(req);
    const rawReason = body(req).reason;
    const reason = rawReason === undefined || rawReason === "" ? { ok: true as const, value: "" } : cleanText(rawReason, LIMITS.reasonMax);
    if (!reason.ok) throw new PartyError("INVALID_INPUT", `Reasons are up to ${LIMITS.reasonMax} characters.`);
    const result = db.reportPrompt(prompt.id, u.uid, reason.value);
    res.status(result.created ? 201 : 200).json({ reported: true, alreadyReported: !result.created });
  });

  // ------------------------------------------------------------ moderation

  const mod = express.Router();
  api.use("/mod", requireUser, requireModerator, mod);

  mod.get("/prompts", (req, res) => {
    const view = String(req.query.view ?? "pending");
    if (view !== "reported" && !PROMPT_STATUSES.includes(view as PromptStatus)) throw new PartyError("INVALID_INPUT");
    const u = user(res);
    res.json(db.listForModeration(view as PromptStatus | "reported").map((p) => publicPrompt(p, u.uid, true)));
  });

  mod.get("/prompts/:id/reports", (req, res) => {
    res.json(db.listReports(loadPrompt(req).id));
  });

  mod.post("/prompts/:id/dismiss-reports", (req, res) => {
    db.dismissReports(loadPrompt(req).id);
    res.json({ ok: true });
  });

  mod.post("/categories", (req, res) => {
    const name = String(body(req).name ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(name)) throw new PartyError("INVALID_INPUT", "Category names: 1–24 lowercase letters, numbers or dashes.");
    db.addCategory(name);
    res.status(201).json(db.listCategories());
  });

  mod.delete("/categories/:name", (req, res) => {
    const name = String(req.params.name);
    if (name === "general") throw new PartyError("INVALID_INPUT", "The general category can't be removed.");
    if (!db.deleteCategory(name)) throw new PartyError("NOT_FOUND");
    res.json(db.listCategories());
  });

  mod.get("/packs", (_req, res) => {
    res.json(db.listPacks());
  });

  function parsePackInput(input: Record<string, unknown>, partial: boolean) {
    const out: { name?: string; description?: string; enabled?: boolean } = {};
    if (!partial || input.name !== undefined) {
      const name = cleanText(input.name, 40);
      if (!name.ok) throw new PartyError("INVALID_INPUT", "Pack names are 1–40 characters.");
      out.name = name.value;
    }
    if (input.description !== undefined && input.description !== "") {
      const description = cleanText(input.description, 200);
      if (!description.ok) throw new PartyError("INVALID_INPUT", "Descriptions are up to 200 characters.");
      out.description = description.value;
    } else if (input.description === "") {
      out.description = "";
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new PartyError("INVALID_INPUT");
      out.enabled = input.enabled;
    }
    return out;
  }

  mod.post("/packs", (req, res) => {
    const input = parsePackInput(body(req), false);
    const pack = db.createPack(input.name!, input.description ?? "");
    if (!pack) throw new PartyError("INVALID_INPUT", "A pack with that name already exists.");
    res.status(201).json(pack);
  });

  mod.patch("/packs/:id", (req, res) => {
    const pack = db.updatePack(idParam(req), parsePackInput(body(req), true));
    if (!pack) throw new PartyError("INVALID_INPUT", "That pack doesn't exist or the name is taken.");
    res.json(pack);
  });

  mod.get("/settings", (_req, res) => {
    res.json(db.getSettings());
  });

  mod.put("/settings", (req, res) => {
    const input = body(req);
    const changes: { moderationPolicy?: ModerationPolicy; reportThreshold?: number } = {};
    if (input.moderationPolicy !== undefined) {
      if (!MODERATION_POLICIES.includes(input.moderationPolicy as ModerationPolicy)) throw new PartyError("INVALID_INPUT");
      changes.moderationPolicy = input.moderationPolicy as ModerationPolicy;
    }
    if (input.reportThreshold !== undefined) {
      const n = input.reportThreshold;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 20) {
        throw new PartyError("INVALID_INPUT", "Report threshold must be 0–20 (0 turns automatic disabling off).");
      }
      changes.reportThreshold = n;
    }
    res.json(db.updateSettings(changes));
  });

  // ------------------------------------------------------------ errors

  api.use((_req, _res, next) => next(new PartyError("NOT_FOUND")));
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = (err as { type?: string } | null)?.type;
    const normalized = type === "entity.parse.failed" || type === "entity.too.large" ? new PartyError("INVALID_INPUT") : err;
    const payload = toClientError(normalized);
    res.status(STATUS_BY_ERROR[payload.error] ?? 400).json(payload);
  });

  return api;
}
