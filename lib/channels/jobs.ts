import { Prisma } from "@prisma/client";
import { publishablePostWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";
import {
  runSearchReindexBatch,
  synchronizeSearchEntity
} from "@/lib/search/repository";
import { indexSearchEntityJobKey } from "@/lib/search/jobs";

const MAX_JOB_ATTEMPTS = 8;
const MAX_JOB_BATCH = 100;
export const PHASE7_JOB_LEASE_MS = 5 * 60 * 1000;

export function materializeChannelJobKey(channelId: string, channelUpdatedAt: Date): string {
  if (!channelId) throw new TypeError("Channel ID is required.");
  if (!(channelUpdatedAt instanceof Date) || !Number.isFinite(channelUpdatedAt.getTime())) {
    throw new TypeError("Channel updatedAt must be a valid date.");
  }
  return `materialize:${channelId}:${channelUpdatedAt.toISOString()}`;
}

export function indexEntityJobKey(entityType: string, entityId: string, sourceUpdatedAt: Date): string {
  return indexSearchEntityJobKey(
    entityType as "post" | "creator" | "channel",
    entityId,
    sourceUpdatedAt,
    "index_entity"
  );
}

export function deleteIndexJobKey(entityType: string, entityId: string, sourceUpdatedAt: Date): string {
  return indexSearchEntityJobKey(
    entityType as "post" | "creator" | "channel",
    entityId,
    sourceUpdatedAt,
    "delete_index"
  );
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

type Phase7JobLease = {
  id: string;
  status: string;
  lockedAt: Date | null;
  attempts: number;
};

type Phase7JobLeaseOutcome =
  | { kind: "completed" }
  | { kind: "progress"; stage: string; cursor: string | null }
  | { kind: "failed" };

export function phase7JobLeaseWhere(lease: Phase7JobLease): Prisma.ChannelJobWhereInput {
  if (
    !lease.id
    || lease.status !== "processing"
    || !(lease.lockedAt instanceof Date)
    || !Number.isFinite(lease.lockedAt.getTime())
    || !Number.isInteger(lease.attempts)
    || lease.attempts < 1
  ) {
    throw new TypeError("Phase 7 job lease is invalid.");
  }
  return {
    id: lease.id,
    status: "processing",
    lockedAt: lease.lockedAt,
    attempts: lease.attempts
  };
}

export function phase7NextLeaseAvailableAt(
  lockedAt: Date,
  now = new Date()
): Date {
  if (
    !(lockedAt instanceof Date)
    || !Number.isFinite(lockedAt.getTime())
    || !(now instanceof Date)
    || !Number.isFinite(now.getTime())
  ) {
    throw new TypeError("Phase 7 job lease timestamps are invalid.");
  }
  return new Date(Math.max(now.getTime(), lockedAt.getTime() + 1));
}

export async function settlePhase7JobLease(
  lease: Phase7JobLease,
  outcome: Phase7JobLeaseOutcome
): Promise<boolean> {
  let data: Prisma.ChannelJobUpdateManyMutationInput;
  if (outcome.kind === "completed") {
    data = {
      status: "completed",
      completedAt: new Date(),
      lockedAt: null,
      lastError: null
    };
  } else if (outcome.kind === "progress") {
    data = {
      status: "pending",
      attempts: 0,
      availableAt: phase7NextLeaseAvailableAt(lease.lockedAt!),
      lockedAt: null,
      completedAt: null,
      lastError: null,
      entityType: outcome.stage,
      entityId: outcome.cursor
    };
  } else {
    const terminal = lease.attempts >= MAX_JOB_ATTEMPTS;
    data = {
      status: "failed",
      availableAt: new Date(
        Date.now() + phase7JobBackoffSeconds(lease.attempts) * 1000
      ),
      lockedAt: null,
      completedAt: null,
      lastError: terminal
        ? "Phase 7 job failed after the maximum retry attempts."
        : "Phase 7 job execution failed and is scheduled for retry."
    };
  }
  const result = await prisma.channelJob.updateMany({
    where: phase7JobLeaseWhere(lease),
    data
  });
  return result.count === 1;
}

function postRuleWhere(rules: Array<{ kind: string; value: string }>): Prisma.PostWhereInput[] {
  return rules.map((rule) => {
    if (rule.kind === "category") return { category: rule.value };
    if (rule.kind === "creator") return { creatorId: rule.value };
    if (rule.kind === "tag") return { tags: { array_contains: rule.value } };
    throw new Error("Unsupported channel rule kind.");
  });
}

function isMaterializationConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ["P2002", "P2034"].includes(String((error as { code?: unknown }).code));
}

async function retryMaterialization<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isMaterializationConflict(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Channel materialization retry failed.");
}

export async function materializeChannel(channelId: string): Promise<{
  matched: number;
  activated: number;
  removed: number;
}> {
  return retryMaterialization(() => prisma.$transaction(async (tx) => {
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
          where: { ...publishablePostWhere, OR: ruleWhere },
          select: { id: true }
        })
      : [];
    const eligibleIds = new Set(
      matchedPosts.map(({ id }) => id).filter((postId) => !excludedIds.has(postId))
    );

    let activated = 0;
    for (const postId of eligibleIds) {
      const exclusion = await tx.channelPostExclusion.findUnique({
        where: { channelId_postId: { channelId, postId } },
        select: { id: true }
      });
      if (exclusion) {
        await tx.channelPost.updateMany({
          where: { channelId, postId, status: { not: "removed" } },
          data: { status: "removed", reviewedByUserId: channel.ownerUserId }
        });
        continue;
      }
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

async function claimPhase7Jobs(limit: number) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const leaseExpiredAt = new Date(now.getTime() - PHASE7_JOB_LEASE_MS);
        await tx.channelJob.updateMany({
          where: {
            status: "processing",
            attempts: { gte: MAX_JOB_ATTEMPTS },
            OR: [
              { lockedAt: null },
              { lockedAt: { lte: leaseExpiredAt } }
            ]
          },
          data: {
            status: "failed",
            lockedAt: null,
            completedAt: null,
            lastError: "Phase 7 job failed after the maximum retry attempts."
          }
        });
        const claimable = {
          OR: [
            {
              status: { in: ["pending", "failed"] },
              availableAt: { lte: now }
            },
            {
              status: "processing",
              OR: [
                { lockedAt: null },
                { lockedAt: { lte: leaseExpiredAt } }
              ]
            }
          ],
          attempts: { lt: MAX_JOB_ATTEMPTS }
        } satisfies Prisma.ChannelJobWhereInput;
        const candidates = await tx.channelJob.findMany({
          where: claimable,
          orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          take: limit,
          select: { id: true }
        });
        const claimed = [];
        for (const candidate of candidates) {
          const result = await tx.channelJob.updateMany({
            where: {
              id: candidate.id,
              ...claimable
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
  id: string;
  kind: string;
  channelId: string | null;
  entityType: string | null;
  entityId: string | null;
}): Promise<
  | { completed: true }
  | {
      completed: false;
      stage: string;
      cursor: string | null;
    }
> {
  if (job.kind === "materialize_channel") {
    if (!job.channelId) throw new Error("Materialization job is missing its channel.");
    await materializeChannel(job.channelId);
    return { completed: true };
  }
  if (job.kind === "index_entity" || job.kind === "delete_index") {
    if (
      !job.entityId
      || !job.entityType
      || !["post", "creator", "channel"].includes(job.entityType)
    ) {
      throw new Error("Search entity job is missing a supported entity.");
    }
    await synchronizeSearchEntity(
      job.entityType as "post" | "creator" | "channel",
      job.entityId
    );
    return { completed: true };
  }
  if (job.kind === "reindex_all") {
    const batch = await runSearchReindexBatch({
      stage: job.entityType,
      cursor: job.entityId
    });
    return batch.completed
      ? { completed: true }
      : {
          completed: false,
          stage: batch.stage,
          cursor: batch.cursor
        };
  }
  throw new Error("Unsupported Phase 7 job kind.");
}

export type Phase7JobRunCounter = {
  claimed: number;
  completed: number;
  failed: number;
};

export type Phase7JobRunSummary = Phase7JobRunCounter & {
  channelMaterialization: Phase7JobRunCounter;
  searchIndexing: Phase7JobRunCounter;
};

export async function runPhase7Jobs(limit = 25): Promise<Phase7JobRunSummary> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_BATCH) {
    throw new TypeError(`Phase 7 job limit must be an integer between 1 and ${MAX_JOB_BATCH}.`);
  }
  const jobs = await claimPhase7Jobs(limit);
  const summary: Phase7JobRunSummary = {
    claimed: jobs.length,
    completed: 0,
    failed: 0,
    channelMaterialization: { claimed: 0, completed: 0, failed: 0 },
    searchIndexing: { claimed: 0, completed: 0, failed: 0 }
  };
  for (const job of jobs) {
    const group = job.kind === "materialize_channel"
      ? summary.channelMaterialization
      : summary.searchIndexing;
    group.claimed += 1;
    try {
      const execution = await executePhase7Job(job);
      if (execution.completed) {
        if (await settlePhase7JobLease(job, { kind: "completed" })) {
          summary.completed += 1;
          group.completed += 1;
        }
      } else {
        await settlePhase7JobLease(job, {
          kind: "progress",
          stage: execution.stage,
          cursor: execution.cursor
        });
      }
    } catch {
      if (await settlePhase7JobLease(job, { kind: "failed" })) {
        summary.failed += 1;
        group.failed += 1;
      }
    }
  }
  return summary;
}
