import { Queue, QueueEvents } from "bullmq";
import { createRedis } from "./redis";
import type { BatchResult } from "./validation";

export interface ValidationJob {
  domain: string;
  emails: string[];
  firstName: string;
  lastName: string;
}

// One queue per MX host allows per-host concurrency limits
export const VALIDATION_QUEUE = "email-validation";

export const queue = new Queue<ValidationJob, BatchResult>(VALIDATION_QUEUE, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 3600 },  // keep results 1 hour
    removeOnFail: { age: 3600 },
  },
});

export const queueEvents = new QueueEvents(VALIDATION_QUEUE, {
  connection: createRedis(),
});

// Wait for a job to finish (used by the API to respond synchronously when fast)
export function waitForJob(jobId: string, timeoutMs = 20000): Promise<BatchResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);

    const onComplete = ({ jobId: id, returnvalue }: { jobId: string; returnvalue: string }) => {
      if (id !== jobId) return;
      cleanup();
      resolve(JSON.parse(returnvalue) as BatchResult);
    };

    const onFailed = ({ jobId: id, failedReason }: { jobId: string; failedReason: string }) => {
      if (id !== jobId) return;
      cleanup();
      reject(new Error(failedReason));
    };

    function cleanup() {
      clearTimeout(timer);
      queueEvents.off("completed", onComplete);
      queueEvents.off("failed", onFailed);
    }

    queueEvents.on("completed", onComplete);
    queueEvents.on("failed", onFailed);
  });
}
