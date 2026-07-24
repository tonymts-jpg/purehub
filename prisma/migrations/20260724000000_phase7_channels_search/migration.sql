CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "avatarAssetId" TEXT,
    "coverAssetId" TEXT,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "discoverability" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ownerUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "memberPostPolicy" TEXT NOT NULL DEFAULT 'approval_required',
    "reviewNote" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelMembership" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelPost" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "position" INTEGER,
    "pinnedAt" TIMESTAMP(3),
    "addedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelRule" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelPostExclusion" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "excludedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelPostExclusion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelQuotaOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxChannels" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelQuotaOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelInvitation" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedUserId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelInvitation_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "ChannelJob" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ChannelJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchDocument" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "popularityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SearchDocument"
    ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("keywords", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("body", '')), 'C')
    ) STORED;

CREATE UNIQUE INDEX "Channel_slug_key" ON "Channel"("slug");
CREATE INDEX "Channel_status_visibility_createdAt_idx" ON "Channel"("status", "visibility", "createdAt");
CREATE INDEX "Channel_ownerUserId_status_idx" ON "Channel"("ownerUserId", "status");
CREATE UNIQUE INDEX "ChannelMembership_channelId_userId_key" ON "ChannelMembership"("channelId", "userId");
CREATE INDEX "ChannelMembership_userId_status_idx" ON "ChannelMembership"("userId", "status");
CREATE UNIQUE INDEX "ChannelPost_channelId_postId_key" ON "ChannelPost"("channelId", "postId");
CREATE INDEX "ChannelPost_channelId_status_pinnedAt_position_createdAt_idx" ON "ChannelPost"("channelId", "status", "pinnedAt" DESC, "position", "createdAt" DESC);
CREATE INDEX "ChannelRule_channelId_enabled_idx" ON "ChannelRule"("channelId", "enabled");
CREATE UNIQUE INDEX "ChannelPostExclusion_channelId_postId_key" ON "ChannelPostExclusion"("channelId", "postId");
CREATE UNIQUE INDEX "ChannelQuotaOverride_userId_key" ON "ChannelQuotaOverride"("userId");
CREATE UNIQUE INDEX "ChannelInvitation_tokenHash_key" ON "ChannelInvitation"("tokenHash");
CREATE INDEX "ChannelInvitation_channelId_status_expiresAt_idx" ON "ChannelInvitation"("channelId", "status", "expiresAt");
CREATE UNIQUE INDEX "ChannelJob_idempotencyKey_key" ON "ChannelJob"("idempotencyKey");
CREATE INDEX "ChannelJob_status_availableAt_idx" ON "ChannelJob"("status", "availableAt");
CREATE INDEX "ChannelJob_channelId_status_idx" ON "ChannelJob"("channelId", "status");
CREATE UNIQUE INDEX "SearchDocument_entityType_entityId_key" ON "SearchDocument"("entityType", "entityId");
CREATE INDEX "SearchDocument_entityType_publishedAt_idx" ON "SearchDocument"("entityType", "publishedAt");
CREATE INDEX "SearchDocument_searchVector_idx" ON "SearchDocument" USING GIN ("searchVector");
CREATE INDEX "SearchDocument_title_trgm_idx" ON "SearchDocument" USING GIN (lower("title") gin_trgm_ops);

ALTER TABLE "Channel" ADD CONSTRAINT "Channel_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelPost" ADD CONSTRAINT "ChannelPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelPost" ADD CONSTRAINT "ChannelPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelPost" ADD CONSTRAINT "ChannelPost_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelPost" ADD CONSTRAINT "ChannelPost_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelRule" ADD CONSTRAINT "ChannelRule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelRule" ADD CONSTRAINT "ChannelRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelPostExclusion" ADD CONSTRAINT "ChannelPostExclusion_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelPostExclusion" ADD CONSTRAINT "ChannelPostExclusion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelPostExclusion" ADD CONSTRAINT "ChannelPostExclusion_excludedByUserId_fkey" FOREIGN KEY ("excludedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelQuotaOverride" ADD CONSTRAINT "ChannelQuotaOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelQuotaOverride" ADD CONSTRAINT "ChannelQuotaOverride_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelInvitation" ADD CONSTRAINT "ChannelInvitation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelInvitation" ADD CONSTRAINT "ChannelInvitation_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelInvitation" ADD CONSTRAINT "ChannelInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelInvitation" ADD CONSTRAINT "ChannelInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelJob" ADD CONSTRAINT "ChannelJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
