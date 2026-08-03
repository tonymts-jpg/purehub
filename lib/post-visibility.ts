import { Prisma } from "@prisma/client";
import type { Visibility } from "./types";

export const PUBLISHABLE_POST_VISIBILITIES = ["free", "members", "purchase"] as const;

const publishablePostVisibilitySet = new Set<string>(PUBLISHABLE_POST_VISIBILITIES);

export function isPublishablePostVisibility(value: string): value is Visibility {
  return publishablePostVisibilitySet.has(value);
}

export const publishablePostWhere = {
  visibility: { in: [...PUBLISHABLE_POST_VISIBILITIES] }
} satisfies Prisma.PostWhereInput;
