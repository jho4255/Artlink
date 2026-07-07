/**
 * 작가 제출자료(cv/note 등 JSON 객체)에 실제 내용이 있는지 판정.
 *
 * 배경: 작가가 한 번이라도 저장하면 빈 약력/작가노트도 `{statement:'',sections:[]}` 같은
 * 빈 객체로 저장된다. 이때 `!!cv` / `!!note`는 truthy가 되어 "제출 완료"로 오판정되고,
 * 갤러리의 완료 카운트가 부풀거나 자료요청 DM 대상에서 누락된다.
 * 문자열은 trim 후 비어있지 않아야, 배열은 원소가 있어야 '내용 있음'으로 본다.
 * (representativeIndex 같은 숫자/불리언 필드는 '내용'으로 치지 않는다.)
 */
export function hasSubmissionContent(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some((v) => {
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return hasSubmissionContent(v);
    return false;
  });
}
