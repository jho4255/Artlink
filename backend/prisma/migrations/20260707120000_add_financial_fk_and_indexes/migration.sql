-- 핫패스 인덱스: 지원 정원 count/지원자 목록(exhibitionId), 찜 역방향 조회(galleryId/exhibitionId/showId), 정산 작가별 조회
CREATE INDEX "Application_exhibitionId_idx" ON "Application"("exhibitionId");
CREATE INDEX "Favorite_galleryId_idx" ON "Favorite"("galleryId");
CREATE INDEX "Favorite_exhibitionId_idx" ON "Favorite"("exhibitionId");
CREATE INDEX "Favorite_showId_idx" ON "Favorite"("showId");
CREATE INDEX "ArtworkSale_artistUserId_idx" ON "ArtworkSale"("artistUserId");
CREATE INDEX "ArtistSettlement_artistUserId_idx" ON "ArtistSettlement"("artistUserId");
CREATE INDEX "SettlementApproval_artistUserId_idx" ON "SettlementApproval"("artistUserId");

-- 재무 테이블 참조 무결성: artistUserId → User (삭제 제한). 회원은 소프트삭제(deletedAt)만 하므로 Restrict가 정상.
ALTER TABLE "ArtworkSale" ADD CONSTRAINT "ArtworkSale_artistUserId_fkey" FOREIGN KEY ("artistUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArtistSettlement" ADD CONSTRAINT "ArtistSettlement_artistUserId_fkey" FOREIGN KEY ("artistUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementApproval" ADD CONSTRAINT "SettlementApproval_artistUserId_fkey" FOREIGN KEY ("artistUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
