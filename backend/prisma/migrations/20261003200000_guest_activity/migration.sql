-- 비회원 둘러보기 (2026-10-03, Admin [통계] 탭) — 로그인하지 않은 방문의 본 화면 순서·머문 시간.
-- 사람을 알아볼 수 있는 칸은 없다(방문마다 새로 만드는 무작위 id, 계정·IP 와 연결하지 않음). 90일 뒤 지운다.
CREATE TABLE "GuestVisit" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "GuestVisit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuestPageView" (
    "id" SERIAL NOT NULL,
    "visitId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestPageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuestVisit_startedAt_idx" ON "GuestVisit"("startedAt");
CREATE INDEX "GuestVisit_lastSeenAt_idx" ON "GuestVisit"("lastSeenAt");
CREATE UNIQUE INDEX "GuestPageView_visitId_seq_key" ON "GuestPageView"("visitId", "seq");

ALTER TABLE "GuestPageView" ADD CONSTRAINT "GuestPageView_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "GuestVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
