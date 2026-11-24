/**
 * 갤러리 결과물 문서의 공통 입력 (2026-11-24, 규칙 92).
 * 문서 빌더(workList·submissionDoc·settlementDoc·applicationDoc)는 **순수 함수**다 — 이미지·글꼴·네트워크는 render.ts 가 맡는다.
 * 그래서 빌더는 jsdom 테스트에서 문서 정의(JSON)로 검사할 수 있다.
 */
import type { OperationSubmission } from '@/types';

/** 문서마다 그림 크기 — 박스에 맞춰 줄여 심는다(원본을 통째로 심으면 표 한 장에 수십 MB) */
export type ImgClass = 'thumb' | 'mid';
/** 그림 긴 변(px) — thumb 48pt 칸 ≈ 360dpi, mid 172pt 칸 ≈ 300dpi */
export const IMG_PX: Record<ImgClass, number> = { thumb: 240, mid: 720 };

/**
 * 그림 주소 → 문서에 심을 data URL. 못 받았으면 null(빌더가 빈 칸으로 그린다 — 그리고 호출부가 몇 장인지 알린다).
 * 빌더를 두 번 돈다: 처음엔 어떤 그림이 몇 크기로 필요한지 적어 두는 함수(record), 다음엔 진짜 그림.
 */
export type ImgFn = (url: string | null | undefined, cls: ImgClass) => string | null;

/** 문서 머리에 찍는 공모 정보 — `loadDocContext` 가 공개 상세에서 채운다 */
export interface DocContext {
  exTitle: string;
  /** 발행한 곳 — 주관 갤러리 이름, 갤러리 없는 아트링크 주최면 '아트링크' */
  issuer: string;
  /** 전시 기간 '2027. 3. 20 – 4. 6' (없으면 '') */
  period: string;
  /** 발행일 '2027. 4. 12.' (오늘, KST) */
  issued: string;
  /** 연락처 한 줄 '02-000-0000 · 서울 영등포구 …' (작가 정산서 아래) */
  contact: string;
}

/** 운영 화면의 출품 자료 한 줄(GET /operations/:id/submissions) */
export interface SubmissionRowLike {
  user: { id: number; name: string; nickname?: string | null; email?: string | null; handle?: string | null };
  guest?: boolean;
  submission: OperationSubmission;
}
