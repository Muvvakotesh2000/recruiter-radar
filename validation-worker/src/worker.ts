/**
 * BullMQ worker process — run N of these for horizontal scaling.
 * Each worker picks jobs from the queue and runs SMTP validation.
 *
 * Start multiple workers:
 *   node dist/worker.js   (in 4–8 separate processes or containers)
 *
 * Per-MX-host concurrency is controlled by the queue's rate limiter.
 */

import { Worker, Job } from "bullmq";
import { createRedis } from "./redis";
import { validateBatch } from "./validation";
import type { BatchResult } from "./validation";
import type { ValidationJob } from "./queue";
import { VALIDATION_QUEUE } from "./queue";

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10);

const worker = new Worker<ValidationJob, BatchResult>(
  VALIDATION_QUEUE,
  async (job: Job<ValidationJob, BatchResult>) => {
    const { domain, emails, firstName, lastName } = job.data;
    console.log(`[worker] processing job ${job.id} — domain: ${domain}, ${emails.length} emails`);
    return validateBatch(domain, emails, firstName, lastName);
  },
  {
    connection: createRedis(),
    concurrency: CONCURRENCY,
    // Rate limit: max 2 jobs processed per second per worker instance.
    // With 4 workers this gives 8 SMTP sessions/sec — enough throughput
    // without triggering mail server rate limits.
    limiter: {
      max: 2,
      duration: 1000,
    },
  }
);

worker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[worker] error:", err);
});

console.log(`[worker] started — concurrency: ${CONCURRENCY}, queue: ${VALIDATION_QUEUE}`);

// Graceful shutdown
async function shutdown() {
  console.log("[worker] shutting down gracefully…");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
