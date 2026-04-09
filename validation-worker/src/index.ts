/**
 * HTTP API process — receives requests from Vercel, enqueues jobs,
 * waits for results (up to 20s), falls back to async polling.
 */

import express, { Request, Response, NextFunction } from "express";
import { queue, waitForJob } from "./queue";
import { cacheGet, cacheSet, TTL } from "./cache";
import { redis } from "./redis";
import { isValidSyntax } from "./validation";
import type { BatchResult } from "./validation";

const app = express();
app.use(express.json({ limit: "1mb" }));

const SECRET = process.env.VALIDATION_SECRET;
const PORT = process.env.PORT ?? 3001;

// ─── Auth ─────────────────────────────────────────────────────────────────────

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  if (!SECRET) { next(); return; }
  if (req.headers["x-validation-secret"] !== SECRET) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  next();
}

// ─── Rate limit (per IP, using Redis — survives restarts) ────────────────────

async function rateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim()
    ?? req.socket.remoteAddress ?? "unknown";
  const key = `ratelimit:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60); // 60-second window
  if (count > 120) { // 120 req/min per IP
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  const [waiting, active] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
  ]);
  res.json({ status: "ok", queue: { waiting, active }, timestamp: new Date().toISOString() });
});

/**
 * POST /validate-batch
 * Body: { domain, emails[], first_name, last_name }
 *
 * Strategy:
 *  1. Check Redis result cache — instant response if recent result exists
 *  2. Enqueue job and wait up to 20s for it to complete (sync-style for Vercel)
 *  3. If 20s timeout → return jobId so client can poll /result/:jobId
 */
app.post("/validate-batch", requireSecret, rateLimit, async (req: Request, res: Response): Promise<void> => {
  const { domain, emails, first_name, last_name } = req.body as {
    domain?: string;
    emails?: string[];
    first_name?: string;
    last_name?: string;
  };

  if (!domain || !Array.isArray(emails) || !emails.length || !first_name || !last_name) {
    res.status(400).json({ error: "domain, emails[], first_name, last_name required" });
    return;
  }
  if (emails.length > 20) {
    res.status(400).json({ error: "Max 20 emails per batch" });
    return;
  }

  const validEmails = emails.filter(isValidSyntax);
  const cacheKey = `result:${domain}:${validEmails.sort().join(",")}`;

  // 1. Cache hit
  const cached = await cacheGet<BatchResult>(cacheKey);
  if (cached) { res.json({ ...cached, cached: true }); return; }

  // 2. Enqueue and wait
  const job = await queue.add("validate", {
    domain,
    emails: validEmails,
    firstName: first_name,
    lastName: last_name,
  });

  try {
    const result = await waitForJob(job.id!, 20000);
    await cacheSet(cacheKey, result, TTL.RESULT);
    res.json(result);
  } catch {
    // 3. Timeout — return jobId for polling
    res.status(202).json({
      status: "queued",
      jobId: job.id,
      pollUrl: `/result/${job.id}`,
      message: "Job queued. Poll /result/:jobId for the result.",
    });
  }
});

/**
 * GET /result/:jobId
 * Poll for async job result (used when /validate-batch times out)
 */
app.get("/result/:jobId", requireSecret, async (req: Request, res: Response): Promise<void> => {
  const job = await queue.getJob(req.params.jobId);

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const state = await job.getState();

  if (state === "completed") {
    res.json({ status: "completed", result: job.returnvalue });
    return;
  }
  if (state === "failed") {
    res.status(500).json({ status: "failed", error: job.failedReason });
    return;
  }

  res.json({ status: state, jobId: job.id });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
  if (!SECRET) console.warn("[api] WARNING: VALIDATION_SECRET not set");
});

async function shutdown() {
  console.log("[api] shutting down…");
  await queue.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
