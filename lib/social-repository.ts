import { prisma } from "@/lib/prisma";

export async function setFollow(userId: string, handle: string, following: boolean) {
  return prisma.$transaction(async (tx) => {
    const creator = await tx.user.findUnique({ where: { handle }, select: { id: true, role: true } });
    if (!creator || creator.role !== "creator") throw new Error("Creator not found.");
    if (creator.id === userId) throw new Error("You cannot follow yourself.");
    const existing = await tx.follow.findUnique({ where: { userId_creatorId: { userId, creatorId: creator.id } } });
    if (following && !existing) {
      await tx.follow.create({ data: { userId, creatorId: creator.id } });
      await tx.creatorProfile.updateMany({ where: { userId: creator.id }, data: { followers: { increment: 1 } } });
      await tx.notification.upsert({
        where: { eventKey: `follow:${userId}:${creator.id}` },
        update: { createdAt: new Date(), readAt: null },
        create: { recipientUserId: creator.id, actorUserId: userId, type: "follow", eventKey: `follow:${userId}:${creator.id}` }
      });
    }
    if (!following && existing) {
      await tx.follow.delete({ where: { id: existing.id } });
      await tx.creatorProfile.updateMany({ where: { userId: creator.id, followers: { gt: 0 } }, data: { followers: { decrement: 1 } } });
    }
    const profile = await tx.creatorProfile.findUnique({ where: { userId: creator.id }, select: { followers: true } });
    return { following, followerCount: profile?.followers ?? 0 };
  });
}

export async function setLike(userId: string, postId: string, liked: boolean) {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: postId }, select: { id: true, creatorId: true } });
    if (!post) throw new Error("Post not found.");
    const existing = await tx.postLike.findUnique({ where: { userId_postId: { userId, postId } } });
    if (liked && !existing) {
      await tx.postLike.create({ data: { userId, postId } });
      await tx.post.update({ where: { id: postId }, data: { likes: { increment: 1 } } });
      if (post.creatorId !== userId) {
        await tx.notification.upsert({
          where: { eventKey: `like:${userId}:${postId}` },
          update: { createdAt: new Date(), readAt: null },
          create: { recipientUserId: post.creatorId, actorUserId: userId, type: "like", eventKey: `like:${userId}:${postId}`, postId }
        });
      }
    }
    if (!liked && existing) {
      await tx.postLike.delete({ where: { id: existing.id } });
      await tx.post.update({ where: { id: postId }, data: { likes: { decrement: 1 } } });
    }
    const postState = await tx.post.findUniqueOrThrow({ where: { id: postId }, select: { likes: true } });
    return { liked, likeCount: postState.likes };
  });
}

export async function setBookmark(userId: string, postId: string, bookmarked: boolean) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw new Error("Post not found.");
  if (bookmarked) {
    await prisma.bookmark.upsert({ where: { userId_postId: { userId, postId } }, update: {}, create: { userId, postId } });
  } else {
    await prisma.bookmark.deleteMany({ where: { userId, postId } });
  }
  return { bookmarked };
}

export async function listComments(postId: string, cursor?: string) {
  if (!process.env.DATABASE_URL) return { comments: [], nextCursor: null };
  const comments = await prisma.postComment.findMany({
    where: { postId, status: "visible" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { author: { select: { id: true, name: true, handle: true, avatar: true } } }
  });
  const nextCursor = comments.length > 20 ? comments[19].id : null;
  return { comments: comments.slice(0, 20), nextCursor };
}

export async function createComment(userId: string, postId: string, content: string) {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: postId }, select: { creatorId: true } });
    if (!post) throw new Error("Post not found.");
    const comment = await tx.postComment.create({
      data: { postId, authorId: userId, content },
      include: { author: { select: { id: true, name: true, handle: true, avatar: true } } }
    });
    if (post.creatorId !== userId) {
      await tx.notification.create({
        data: { recipientUserId: post.creatorId, actorUserId: userId, type: "comment", eventKey: `comment:${comment.id}`, postId, commentId: comment.id }
      });
    }
    return comment;
  });
}

export async function removeComment(userId: string, commentId: string) {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.postComment.findUnique({ where: { id: commentId } });
    if (!comment) throw new Error("Comment not found.");
    const admin = await tx.adminAccount.findFirst({ where: { userId, status: "active", role: { in: ["super_admin", "content_admin"] } } });
    if (comment.authorId !== userId && !admin) throw new Error("You cannot remove this comment.");
    return tx.postComment.update({ where: { id: commentId }, data: { status: "deleted", content: "" } });
  });
}

export async function listNotifications(userId: string, cursor?: string, unreadOnly = false) {
  const notifications = await prisma.notification.findMany({
    where: { recipientUserId: userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { actor: { select: { id: true, name: true, handle: true, avatar: true } }, post: { select: { id: true, title: true } } }
  });
  const nextCursor = notifications.length > 20 ? notifications[19].id : null;
  return { notifications: notifications.slice(0, 20), nextCursor };
}
