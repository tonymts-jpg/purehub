CREATE TABLE "ChannelBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelBookmark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostViewHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostViewHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelBookmark_userId_channelId_key" ON "ChannelBookmark"("userId", "channelId");
CREATE INDEX "ChannelBookmark_userId_createdAt_id_idx" ON "ChannelBookmark"("userId", "createdAt", "id");
CREATE UNIQUE INDEX "PostViewHistory_userId_postId_key" ON "PostViewHistory"("userId", "postId");
CREATE INDEX "PostViewHistory_userId_lastViewedAt_id_idx" ON "PostViewHistory"("userId", "lastViewedAt", "id");

ALTER TABLE "ChannelBookmark" ADD CONSTRAINT "ChannelBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelBookmark" ADD CONSTRAINT "ChannelBookmark_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostViewHistory" ADD CONSTRAINT "PostViewHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostViewHistory" ADD CONSTRAINT "PostViewHistory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
