import { Prisma } from "@prisma/client";
import { z } from "zod";
import { creators, posts as fallbackPosts } from "./data";
import type { AdminContext } from "./admin-auth";
import { prisma } from "./prisma";
import { enqueueSearchEntitySync } from "./search/jobs";

const canUseDatabase = () => Boolean(process.env.DATABASE_URL);
const PAGE_SIZE = 20;
const CONTENT_STATUSES = ["all", "pending", "published", "unpublished", "hidden"] as const;
const CONTENT_ACTIONS = ["publish", "unpublish", "hide"] as const;

export type AdminContentStatus = (typeof CONTENT_STATUSES)[number];
export type AdminContentAction = (typeof CONTENT_ACTIONS)[number];
export type AdminContentListInput = {
  status?: AdminContentStatus;
  q?: string;
  cursor?: string;
};

type AdminContentCursor = {
  updatedAt: string;
  id: string;
  status: AdminContentStatus;
  q: string;
};

export class AdminContentInputError extends Error {}

const actionSchema = z.object({
  action: z.enum(CONTENT_ACTIONS)
}).strict();

export function parseAdminContentListInput(searchParams: URLSearchParams): AdminContentListInput {
  const allowed = new Set(["status", "q", "cursor"]);
  if ([...searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new AdminContentInputError("Unsupported admin content query parameter.");
  }
  if ([...allowed].some((key) => searchParams.getAll(key).length > 1)) {
    throw new AdminContentInputError("Admin content query parameter must be unique.");
  }

  const statusValue = searchParams.get("status");
  const qValue = searchParams.get("q");
  const cursorValue = searchParams.get("cursor");
  if (statusValue && !CONTENT_STATUSES.includes(statusValue as AdminContentStatus)) {
    throw new AdminContentInputError("Invalid admin content status.");
  }
  if (qValue && qValue.trim().length > 100) {
    throw new AdminContentInputError("Admin content search is too long.");
  }

  return {
    ...(statusValue ? { status: statusValue as AdminContentStatus } : {}),
    ...(qValue?.trim() ? { q: qValue.trim() } : {}),
    ...(cursorValue ? { cursor: cursorValue } : {})
  };
}

export function parseAdminContentAction(value: unknown): { action: AdminContentAction } {
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success) throw new AdminContentInputError("Invalid admin content action.");
  return parsed.data;
}

export function deriveAdminContentStatus(visibility: string): Exclude<AdminContentStatus, "all"> {
  if (visibility === "pending") return "pending";
  if (visibility === "hidden") return "hidden";
  if (visibility === "unpublished") return "unpublished";
  return "published";
}

function encodeCursor(cursor: AdminContentCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseCursor(value: string | undefined, input: AdminContentListInput): AdminContentCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AdminContentCursor>;
    const expectedStatus = input.status ?? "all";
    const expectedQuery = input.q ?? "";
    if (
      typeof parsed.id !== "string"
      || typeof parsed.updatedAt !== "string"
      || Number.isNaN(new Date(parsed.updatedAt).getTime())
      || parsed.status !== expectedStatus
      || parsed.q !== expectedQuery
    ) {
      throw new Error("scope");
    }
    return parsed as AdminContentCursor;
  } catch {
    throw new AdminContentInputError("Admin content cursor is invalid.");
  }
}

function visibilityFilter(status: AdminContentStatus): Prisma.PostWhereInput | null {
  if (status === "pending") return { visibility: "pending" };
  if (status === "hidden") return { visibility: "hidden" };
  if (status === "unpublished") return { visibility: "unpublished" };
  if (status === "published") return { visibility: { in: ["free", "members", "purchase"] } };
  return null;
}

export async function listAdminContent(input: AdminContentListInput) {
  const status = input.status ?? "all";
  const q = input.q ?? "";
  const cursor = parseCursor(input.cursor, input);

  if (!canUseDatabase()) {
    const matching = fallbackPosts
      .filter((post) => status === "all" || deriveAdminContentStatus(post.visibility) === status)
      .filter((post) => !q || `${post.title} ${post.excerpt}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()))
      .slice(0, PAGE_SIZE)
      .map((post) => {
        const creator = creators.find(({ id }) => id === post.creatorId);
        return {
          id: post.id,
          title: post.title,
          excerpt: post.excerpt,
          cover: post.cover,
          category: post.category,
          visibility: post.visibility,
          price: post.price ?? null,
          moderationStatus: deriveAdminContentStatus(post.visibility),
          creator: creator ? { id: creator.id, name: creator.name, handle: creator.handle } : null,
          commentCount: Array.isArray(post.comments) ? post.comments.length : 0,
          mediaCount: Array.isArray(post.media) ? post.media.length : post.cover ? 1 : 0,
          updatedAt: new Date(0).toISOString()
        };
      });
    return { posts: matching, nextCursor: null };
  }

  const clauses: Prisma.PostWhereInput[] = [];
  const statusClause = visibilityFilter(status);
  if (statusClause) clauses.push(statusClause);
  if (q) {
    clauses.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { excerpt: { contains: q, mode: "insensitive" } },
        { creator: { is: { name: { contains: q, mode: "insensitive" } } } },
        { creator: { is: { handle: { contains: q, mode: "insensitive" } } } }
      ]
    });
  }
  if (cursor) {
    clauses.push({
      OR: [
        { updatedAt: { lt: new Date(cursor.updatedAt) } },
        { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } }
      ]
    });
  }

  const rows = await prisma.post.findMany({
    where: clauses.length ? { AND: clauses } : undefined,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      title: true,
      excerpt: true,
      cover: true,
      category: true,
      visibility: true,
      contentType: true,
      saleMode: true,
      price: true,
      updatedAt: true,
      creator: { select: { id: true, name: true, handle: true } },
      _count: { select: { commentItems: true, media: true } }
    }
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page.at(-1);

  return {
    posts: page.map(({ _count, ...post }) => ({
      ...post,
      moderationStatus: deriveAdminContentStatus(post.visibility),
      commentCount: _count.commentItems,
      mediaCount: _count.media
    })),
    nextCursor: hasMore && last
      ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id, status, q })
      : null
  };
}

const publishableVisibilities = new Set(["free", "members", "purchase"]);

export function resolveModeratedVisibility(
  action: AdminContentAction,
  currentVisibility: string,
  previousVisibility?: string | null | readonly string[]
) {
  if (action === "hide") return "hidden";
  if (action === "unpublish") return "unpublished";
  if (publishableVisibilities.has(currentVisibility)) return currentVisibility;
  const history = Array.isArray(previousVisibility)
    ? previousVisibility
    : previousVisibility ? [previousVisibility] : [];
  const stable = history.find((visibility) => publishableVisibilities.has(visibility));
  if (stable) return stable;
  return "free";
}

function auditVisibilityHistory(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const object = metadata as Prisma.JsonObject;
  return [object.lastPublishedVisibility, object.previousVisibility]
    .filter((value): value is string => typeof value === "string");
}

export async function moderateAdminContent(
  admin: AdminContext,
  id: string,
  input: { action: AdminContentAction }
) {
  if (!canUseDatabase()) {
    const currentVisibility = fallbackPosts.find((post) => post.id === id)?.visibility ?? "free";
    const visibility = resolveModeratedVisibility(input.action, currentVisibility);
    return {
      id,
      visibility,
      moderationStatus: deriveAdminContentStatus(visibility)
    };
  }

  const post = await prisma.$transaction(async (tx) => {
    const current = await tx.post.findUniqueOrThrow({
      where: { id },
      select: { visibility: true }
    });
    const previousAudits = !publishableVisibilities.has(current.visibility)
      ? await tx.auditLog.findMany({
          where: {
            targetType: "post",
            targetId: id,
            action: { in: ["admin.content.hide", "admin.content.unpublish", "admin.content.publish"] }
          },
          orderBy: { createdAt: "desc" },
          select: { metadata: true },
          take: 100
        })
      : [];
    const visibilityHistory = previousAudits.flatMap(({ metadata }) => auditVisibilityHistory(metadata));
    const lastPublishedVisibility = publishableVisibilities.has(current.visibility)
      ? current.visibility
      : visibilityHistory.find((visibility) => publishableVisibilities.has(visibility)) ?? null;
    const visibility = resolveModeratedVisibility(
      input.action,
      current.visibility,
      visibilityHistory
    );
    const updated = await tx.post.update({
      where: { id },
      data: { visibility }
    });
    await enqueueSearchEntitySync(tx, {
      entityType: "post",
      entityId: updated.id,
      sourceUpdatedAt: updated.updatedAt,
      eligible: updated.visibility === "free"
    });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.actorUserId,
        actorRole: admin.role,
        action: `admin.content.${input.action}`,
        targetType: "post",
        targetId: id,
        metadata: { previousVisibility: current.visibility, lastPublishedVisibility, visibility }
      }
    });
    return updated;
  });

  return {
    id: post.id,
    visibility: post.visibility,
    moderationStatus: deriveAdminContentStatus(post.visibility),
    updatedAt: post.updatedAt
  };
}
