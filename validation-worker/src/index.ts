import express, { Request, Response, NextFunction } from "express";
import { validateBatch, isValidSyntax } from "./validation";

const app = express();
app.use(express.json({ limit: "1mb" }));

const SECRET = process.env.VALIDATION_SECRET;
const PORT = process.env.PORT ?? 3001;

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireSecret(req: Request, res: Response, next: NextFunction): void {
  if (!SECRET) { next(); return; } // secret not configured → open (dev only)
  if (req.headers["x-validation-secret"] !== SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ─── Rate limiting (simple in-memory, per IP) ─────────────────────────────────

const rateLimiter = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 60;      // requests per window
const RATE_WINDOW = 60_000; // 1 minute

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = rateLimiter.get(ip);

  if (!entry || now > entry.reset) {
    rateLimiter.set(ip, { count: 1, reset: now + RATE_WINDOW });
    next();
    return;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// POST /validate-batch
// Body: { domain, emails[], first_name, last_name }
app.post("/validate-batch", requireSecret, rateLimit, async (req: Request, res: Response): Promise<void> => {
  const { domain, emails, first_name, last_name } = req.body as {
    domain?: string;
    emails?: string[];
    first_name?: string;
    last_name?: string;
  };

  if (!domain || !Array.isArray(emails) || emails.length === 0) {
    res.status(400).json({ error: "domain and emails[] are required" });
    return;
  }
  if (!first_name || !last_name) {
    res.status(400).json({ error: "first_name and last_name are required for ranking" });
    return;
  }
  if (emails.length > 20) {
    res.status(400).json({ error: "Maximum 20 emails per batch" });
    return;
  }

  try {
    const result = await validateBatch(domain, emails, first_name, last_name);
    res.json(result);
  } catch (err) {
    console.error("[validate-batch]", err);
    res.status(500).json({ error: "Validation failed" });
  }
});

// POST /validate-email  (single email convenience endpoint)
app.post("/validate-email", requireSecret, rateLimit, async (req: Request, res: Response): Promise<void> => {
  const { email, first_name = "", last_name = "" } = req.body as {
    email?: string;
    first_name?: string;
    last_name?: string;
  };

  if (!email || !isValidSyntax(email)) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const domain = email.split("@")[1];
  try {
    const result = await validateBatch(domain, [email], first_name, last_name);
    res.json(result.results[0] ?? { email, status: "unknown", confidence: "low" });
  } catch (err) {
    console.error("[validate-email]", err);
    res.status(500).json({ error: "Validation failed" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[validation-worker] listening on port ${PORT}`);
  if (!SECRET) console.warn("[validation-worker] WARNING: VALIDATION_SECRET not set — running open");
});
