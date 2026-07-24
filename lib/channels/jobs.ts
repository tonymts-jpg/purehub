import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_JOB_ATTEMPTS = 8;
const MAX_JOB_BATCH = 100;

export function materializeChannelJobKey(channelId: string, channelUpdatedAt: Date): string {
  if (!channelId) throw new TypeError("Channel ID is required.");
  if (!(channelUpdatedAt instanceof Date) || !Number.isFinite(channelUpdatedAt.getTime())) {
    throw new TypeError("Channel updatedAt must be a valid date.");
  }
  return `materialize:${channelId}:${channelUpdatedAt.toISOString()}`;
}

export function indexEntityJobKey(entityType: string, entityId: string, sourceUpdatedAt: Date): string {
  if (!entityType || !entityId) throw new TypeError("Search entity type and ID are required.");
  if (!(sourceUpdatedAt instanceof Date) || !Number.isFinite(sourceUpdatedAt.getTime())) {
    throw new TypeError("Search source updatedAt must be a valid date.");
  }
  return `index:${entityType}:${entityId}:${sourceUpdatedAt.toISOString()}`;
}

export function deleteIndexJobKey(entityType: string, entityId: string, sourceUpdatedAt: Date): string {
  if (!entityType || !entityId) throw new TypeError("Search entity type and ID are required.");
  if (!(sourceUpdatedAt instanceof Date) || !Number.isFinite(sourceUpdatedAt.getTime())) {
    throw new TypeError("Search source updatedAt must be a valid date.");
  }
  return `delete-index:${entityType}:${entityId}:${sourceUpdatedAt.toISOString()}`;
}

export function reindexAllJobKey(requestedAt: Date): string {
  if (!(requestedAt instanceof Date) || !Number.isFinite(requestedAt.getTime())) {
    throw new TypeError("Reindex requestedAt must be a valid date.");
  }
  return `reindex-all:${requestedAt.toISOString()}`;
}

export function phase7JobBackoffSeconds(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new TypeError("Job attempts must be a positive integer.");
  return Math.min(3600, 2 ** attempts * 15);
}

function postRuleWhere(rules: Array<{ kind: string; value: string }>): Prisma.PostWhereInput[] {
  return rules.map((rule) => {
    if (rule.kind === "category") return { category: rule.value };
    if (rule.kind === "creator") return { creatorId: rule.value };
    if (rule.kind === "tag") return { tags: { array_contains: rule.value } };
    throw new Error("Unsupported channel rule kind.");
  });
}

export async function materializeChannel(channelId: string): Promise<{
  matched: number;
  activated: number;
  removed: number;
}> {
  return prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        status: true,
        ownerUserId: true,
        rules: {
          where: { enabled: true },
          select: { kind: true, value: true }
        },
        exclusions: { select: { postId: true } }
      }
    });
    if (!channel) return { matched: 0, activated: 0, removed: 0 };

    const excludedIds = new Set(channel.exclusions.map(({ postId }) => postId));
    const ruleWhere = postRuleWhere(channel.rules);
    const matchedPosts = channel.status === "active" && ruleWhere.length
      ? await tx.post.findMany({
          where: { OR: ruleWhere },
          select: { id: true }
        })
      : [];
    const eligibleIds = new Set(
      matchedPosts.map(({ id }) => id).filter((postId) => !excludedIds.has(postId))
    );

    let activated = 0;
    for (const postId of eligibleIds) {
      const existing = await tx.channelPost.findUnique({
        where: { channelId_postId: { channelId, postId } },
        select: { id: true, source: true, status: true }
      });
      if (existing) {
        if (existing.status !== "active") {
          await tx.channelPost.update({
            where: { id: existing.id },
            data: {
              status: "active",
              reviewedByUserId: channel.ownerUserId
            }
          });
          activated += 1;
        }
      } else {
        await tx.channelPost.create({
          data: {
            channelId,
            postId,
            source: "rule",
            status: "active",
            addedByUserId: channel.ownerUserId,
            reviewedByUserId: channel.ownerUserId
          }
        });
        activated += 1;
      }
    }

    const removed = await tx.channelPost.updateMany({
      where: {
        channelId,
        status: { not: "removed" },
        OR: [
          { source: "rule", postId: { notIn: [...eligibleIds] } },
          ...(excludedIds.size ? [{ postId: { in: [...excludedIds] } }] : [])
        ]
      },
      data: { status: "removed", reviewedByUserId: channel.ownerUserId }
    });
    return { matched: eligibleIds.size, activated, removed: removed.count };
  });
}

async function claimPhase7Jobs(limit: number) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const candidates = await tx.channelJob.findMany({
          where: {
            status: { in: ["pending", "failed"] },
            attempts: { lt: MAX_JOB_ATTEMPTS },
            availableAt: { lte: now }
          },
          orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          take: limit,
          select: { id: true }
        });
        const claimed = [];
        for (const candidate of candidates) {
          const result = await tx.channelJob.updateMany({
            where: {
              id: candidate.id,
              status: { in: ["pending", "failed"] },
              attempts: { lt: MAX_JOB_ATTEMPTS },
              availableAt: { lte: now }
            },
            data: {
              status: "processing",
              attempts: { increment: 1 },
              lockedAt: now,
              completedAt: null
            }
          });
          if (result.count === 1) {
            claimed.push(await tx.channelJob.findUniqueOrThrow({ where: { id: candidate.id } }));
          }
        }
        return claimed;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const serializableConflict = typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: unknown }).code === "P2034";
      if (!serializableConflict || attempt === 3) throw error;
    }
  }
  throw new Error("Phase 7 job claim retry failed.");
}

async function executePhase7Job(job: {
  kind: string;
  channelId: string | null;
}) {
  if (job.kind === "materialize_channel") {
    if (!job.channelId) throw new Error("Materialization job is missing its channel.");
    await materializeChannel(job.channelId);
    return;
  }
  // Task 7 adds search executors. Retain these jobs as retryable failures until
  // then instead of acknowledging and losing unprocessed index work.
  if (job.kind === "index_entity" || job.kind === "delete_index" || job.kind === "reindex_all") {
    throw new Error("Search job execution is not available yet.");
  }
  throw new Error("Unsupported Phase 7 job kind.");
}

export async function runPhase7Jobs(limit = 25): Promise<{
  claimed: number;
  completed: number;
  failed: number;
}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_BATCH) {
    throw new TypeError(`Phase 7 job limit must be an integer between 1 and ${MAX_JOB_BATCH}.`);
  }
  const jobs = await claimPhase7Jobs(limit);
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await executePhase7Job(job);
      await prisma.channelJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          lockedAt: null,
          lastError: null
        }
      });
      completed += 1;
    } catch {
      const terminal = job.attempts >= MAX_JOB_ATTEMPTS;
      const backoffSeconds = phase7JobBackoffSeconds(job.attempts);
      await prisma.channelJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lockedAt: null,
          completedAt: null,
          lastError: terminal
            ? "Phase 7 job failed after the maximum retry attempts."
            : "Phase 7 job execution failed and is scheduled for retry."
        }
      });
      failed += 1;
    }
  }
  return { claimed: jobs.length, completed, failed };
}
