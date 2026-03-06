-- CreateIndex
CREATE INDEX "Application_userId_idx" ON "Application"("userId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "Exhibition_galleryId_idx" ON "Exhibition"("galleryId");

-- CreateIndex
CREATE INDEX "Exhibition_status_deadline_idx" ON "Exhibition"("status", "deadline");

-- CreateIndex
CREATE INDEX "Exhibition_region_idx" ON "Exhibition"("region");

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE INDEX "Gallery_ownerId_idx" ON "Gallery"("ownerId");

-- CreateIndex
CREATE INDEX "Gallery_status_region_idx" ON "Gallery"("status", "region");

-- CreateIndex
CREATE INDEX "Gallery_rating_idx" ON "Gallery"("rating");

-- CreateIndex
CREATE INDEX "GalleryOfMonth_expiresAt_idx" ON "GalleryOfMonth"("expiresAt");

-- CreateIndex
CREATE INDEX "Review_galleryId_idx" ON "Review"("galleryId");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");
