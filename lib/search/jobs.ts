import type { Prisma } from "@prisma/client";

export const SEARCH_ENTITY_TYPES = ["post", "creator", "channel"] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];
export type SearchEntityJobKind = "index_entity" | "delete_index";

export function searchEntityEligibilityJobKind(eligible: boolean): SearchEntityJobKind {
  return eligible ? "index_entity" : "delete_index";
}

export function indexSearchEntityJobKey(
  entityType: SearchEntityType,
  entityId: string,
  sourceUpdatedAt: Date,
  kind: SearchEntityJobKind
): string {
  if (!SEARCH_ENTITY_TYPES.some((candidate) => candidate === entityType) || !entityId) {
    throw new TypeError("Search entity type and ID are required.");
  }
  if (!(sourceUpdatedAt instanceof Date) || !Number.isFinite(sourceUpdatedAt.getTime())) {
    throw new TypeError("Search source updatedAt must be a valid date.");
  }
  const prefix = kind === "index_entity" ? "index" : "delete-index";
  return `${prefix}:${entityType}:${entityId}:${sourceUpdatedAt.toISOString()}`;
}

export async function enqueueSearchEntitySync(
  tx: Prisma.TransactionClient,
  input: {
    entityType: SearchEntityType;
    entityId: string;
    sourceUpdatedAt: Date;
    eligible: boolean;
  }
): Promise<void> {
  const kind = searchEntityEligibilityJobKind(input.eligible);
  const idempotencyKey = indexSearchEntityJobKey(
    input.entityType,
    input.entityId,
    input.sourceUpdatedAt,
    kind
  );
  await tx.channelJob.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      idempotencyKey,
      kind,
      entityType: input.entityType,
      entityId: input.entityId
    }
  });
}
