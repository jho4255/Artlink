-- 판매 작품 결제수단(카드/현금) 컬럼
ALTER TABLE "ArtworkSale" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CARD';
