/**
 * 복합 시나리오 검증 (CLAUDE.md 요구사항)
 * 갤러리 등록 → Admin 승인 → 검색 노출 → 공모 등록 → Admin 승인 → Artist 지원
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers } from '../helpers';

describe('Full Flow Integration', () => {
  beforeAll(async () => {
    await cleanDb();
    await seedUsers();
  });
  afterAll(async () => {
    await cleanDb();
  });

  it('갤러리 등록 → 승인 → 검색 → 공모 등록 → 승인 → 지원 전체 흐름', async () => {
    const galleryToken = `Bearer ${authToken(3, 'GALLERY')}`;
    const adminToken = `Bearer ${authToken(4, 'ADMIN')}`;
    const artistToken = `Bearer ${authToken(1, 'ARTIST')}`;

    // 1. Gallery 유저가 갤러리 등록 → PENDING
    const createGallery = await request.post('/api/galleries')
      .set('Authorization', galleryToken)
      .send({
        name: 'Flow Test Gallery', address: '서울시 강남구', phone: '02-1111-2222',
        description: '통합 테스트 갤러리', region: 'SEOUL', ownerName: 'Test Owner',
      });
    expect(createGallery.status).toBe(201);
    expect(createGallery.body.status).toBe('PENDING');
    const galleryId = createGallery.body.id;

    // 2. PENDING 상태에서는 검색에 노출되지 않음
    const beforeApproval = await request.get('/api/galleries');
    const foundBefore = beforeApproval.body.find((g: any) => g.id === galleryId);
    expect(foundBefore).toBeUndefined();

    // 3. Admin이 갤러리 승인
    const approveGallery = await request.patch(`/api/approvals/gallery/${galleryId}`)
      .set('Authorization', adminToken)
      .send({ status: 'APPROVED' });
    expect(approveGallery.status).toBe(200);
    expect(approveGallery.body.status).toBe('APPROVED');

    // 4. 승인 후 검색에 노출됨
    const afterApproval = await request.get('/api/galleries');
    const foundAfter = afterApproval.body.find((g: any) => g.id === galleryId);
    expect(foundAfter).toBeDefined();
    expect(foundAfter.name).toBe('Flow Test Gallery');

    // 5. Gallery 유저가 공모 등록 → PENDING
    const createExhibition = await request.post('/api/exhibitions')
      .set('Authorization', galleryToken)
      .send({
        galleryId, title: 'Flow Test Exhibition', type: 'SOLO',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        exhibitDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        capacity: 3, region: 'SEOUL', description: '통합 테스트 공모',
      });
    expect(createExhibition.status).toBe(201);
    expect(createExhibition.body.status).toBe('PENDING');
    const exhibitionId = createExhibition.body.id;

    // 6. PENDING 공모는 검색에 노출되지 않음
    const exhBefore = await request.get('/api/exhibitions');
    const exhFoundBefore = exhBefore.body.find((e: any) => e.id === exhibitionId);
    expect(exhFoundBefore).toBeUndefined();

    // 7. Admin이 공모 승인
    const approveExhibition = await request.patch(`/api/approvals/exhibition/${exhibitionId}`)
      .set('Authorization', adminToken)
      .send({ status: 'APPROVED' });
    expect(approveExhibition.status).toBe(200);

    // 8. 승인 후 공모 검색에 노출됨
    const exhAfter = await request.get('/api/exhibitions');
    const exhFoundAfter = exhAfter.body.find((e: any) => e.id === exhibitionId);
    expect(exhFoundAfter).toBeDefined();

    // 9. Artist가 공모에 지원
    const apply = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', artistToken);
    expect(apply.status).toBe(201);

    // 10. 중복 지원 불가
    const applyDup = await request.post(`/api/exhibitions/${exhibitionId}/apply`)
      .set('Authorization', artistToken);
    expect(applyDup.status).toBe(400);

    // 11. Artist의 지원 내역 확인
    const myApps = await request.get('/api/exhibitions/my-applications')
      .set('Authorization', artistToken);
    expect(myApps.status).toBe(200);
    const found = myApps.body.find((a: any) => a.exhibitionId === exhibitionId);
    expect(found).toBeDefined();

    // === 12~18: Instagram 연동 복합 시나리오 ===

    // 12. 갤러리 생성 응답에 instagramConnected가 있고 false
    expect(createGallery.body).toHaveProperty('instagramConnected');
    expect(createGallery.body.instagramConnected).toBe(false);
    expect(createGallery.body).not.toHaveProperty('instagramAccessToken');

    // 13. 갤러리 목록에서도 instagramAccessToken 미노출
    const galleriesCheck = await request.get('/api/galleries');
    for (const g of galleriesCheck.body) {
      expect(g).not.toHaveProperty('instagramAccessToken');
      expect(g).toHaveProperty('instagramConnected');
    }

    // 14. 미연동 상태에서 피드 ON 시도 → 400
    const failVisibility = await request.patch(`/api/galleries/${galleryId}/instagram-visibility`)
      .set('Authorization', galleryToken)
      .send({ visible: true });
    expect(failVisibility.status).toBe(400);

    // 15. 미연동 상태에서 피드 조회 → 빈 배열
    const emptyFeed = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
    expect(emptyFeed.body).toEqual([]);

    // 16. Instagram 토큰 연동 (Graph API mock)
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '99999', username: 'flow_test_gallery' }),
    } as any);

    const saveToken = await request.post(`/api/galleries/${galleryId}/instagram-token`)
      .set('Authorization', galleryToken)
      .send({ accessToken: 'flow_test_valid_token' });
    expect(saveToken.status).toBe(200);
    expect(saveToken.body.instagramConnected).toBe(true);
    expect(saveToken.body.username).toBe('flow_test_gallery');

    // 17. 연동 후 갤러리 상세에서 instagramConnected=true, token 미노출
    const galleryDetail = await request.get(`/api/galleries/${galleryId}`);
    expect(galleryDetail.body.instagramConnected).toBe(true);
    expect(galleryDetail.body.instagramUrl).toBe('@flow_test_gallery');
    expect(galleryDetail.body).not.toHaveProperty('instagramAccessToken');

    // 18. 피드 토글 ON → 피드 조회 시 게시물 반환
    const toggleOn = await request.patch(`/api/galleries/${galleryId}/instagram-visibility`)
      .set('Authorization', galleryToken)
      .send({ visible: true });
    expect(toggleOn.status).toBe(200);

    // 피드 mock
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: '1', media_type: 'IMAGE', media_url: 'https://img/1.jpg', permalink: 'https://ig/p/1', timestamp: '2026-03-10T00:00:00Z' },
        ],
      }),
    } as any);

    const feedOn = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
    expect(feedOn.body.length).toBe(1);
    expect(feedOn.body[0].mediaType).toBe('IMAGE');

    // 19. 피드 토글 OFF → 빈 배열
    await request.patch(`/api/galleries/${galleryId}/instagram-visibility`)
      .set('Authorization', galleryToken)
      .send({ visible: false });

    const feedOff = await request.get(`/api/galleries/${galleryId}/instagram-feed`);
    expect(feedOff.body).toEqual([]);

    // 20. 찜하기는 여전히 정상 동작 (Instagram과 무관)
    const favToggle = await request.post('/api/favorites/toggle')
      .set('Authorization', artistToken)
      .send({ galleryId });
    expect(favToggle.status).toBe(200);

    const galleryWithFav = await request.get(`/api/galleries/${galleryId}`)
      .set('Authorization', artistToken);
    expect(galleryWithFav.body.isFavorited).toBe(true);
    expect(galleryWithFav.body.instagramConnected).toBe(true);

    // 21. Artist는 토큰 저장 불가 (비오너)
    const artistAttempt = await request.post(`/api/galleries/${galleryId}/instagram-token`)
      .set('Authorization', artistToken)
      .send({ accessToken: 'hacker_token' });
    expect(artistAttempt.status).toBe(403);

    global.fetch = originalFetch;
  });

  it('커스텀 필드 포함 공모: 등록 → 승인 → 필드 수정 → 지원(답변) → 필수 누락 차단 전체 흐름', async () => {
    const galleryToken = `Bearer ${authToken(3, 'GALLERY')}`;
    const adminToken = `Bearer ${authToken(4, 'ADMIN')}`;
    const artistToken = `Bearer ${authToken(1, 'ARTIST')}`;
    const artist2Token = `Bearer ${authToken(2, 'ARTIST')}`;

    // 1. 기존 갤러리 찾기 (승인된)
    const galleries = await request.get('/api/galleries');
    const approvedGallery = galleries.body[0];
    expect(approvedGallery).toBeDefined();
    const galleryId = approvedGallery.id;

    // 2. 커스텀 필드 포함 공모 등록
    const customFields = [
      { id: 'q1', label: '작품 컨셉 설명', type: 'textarea', required: true },
      { id: 'q2', label: '전시 경험 횟수', type: 'select', required: true, options: ['없음', '1~3회', '4회 이상'] },
      { id: 'q3', label: '참고 자료', type: 'file', required: false },
    ];
    const createRes = await request.post('/api/exhibitions')
      .set('Authorization', galleryToken)
      .send({
        galleryId, title: 'CF Flow Test', type: 'GROUP',
        deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
        exhibitDate: new Date(Date.now() + 60 * 86400000).toISOString(),
        capacity: 10, region: 'SEOUL', description: 'Custom fields flow test',
        customFields,
      });
    expect(createRes.status).toBe(201);
    const exId = createRes.body.id;

    // 3. Admin 승인
    const approve = await request.patch(`/api/approvals/exhibition/${exId}`)
      .set('Authorization', adminToken)
      .send({ status: 'APPROVED' });
    expect(approve.status).toBe(200);

    // 4. 공모 목록에서 customFields 파싱된 상태 확인
    const listRes = await request.get('/api/exhibitions');
    const found = listRes.body.find((e: any) => e.id === exId);
    expect(found).toBeDefined();
    expect(found.customFields).toHaveLength(3);
    expect(found.customFields[0].label).toBe('작품 컨셉 설명');

    // 5. 상세 조회에서도 파싱 확인
    const detailRes = await request.get(`/api/exhibitions/${exId}`);
    expect(detailRes.body.customFields).toHaveLength(3);
    expect(detailRes.body.customFields[1].options).toEqual(['없음', '1~3회', '4회 이상']);

    // 6. my-exhibitions에서도 파싱 확인
    const myExRes = await request.get('/api/exhibitions/my-exhibitions')
      .set('Authorization', galleryToken);
    const myEx = myExRes.body.find((e: any) => e.id === exId);
    expect(myEx.customFields).toHaveLength(3);

    // 7. 필수 필드 누락하고 지원 → 400
    const failApply = await request.post(`/api/exhibitions/${exId}/apply`)
      .set('Authorization', artistToken)
      .send({ customAnswers: [{ fieldId: 'q3', value: '/uploads/file.pdf' }] });
    expect(failApply.status).toBe(400);

    // 8. 필수 필드 포함하여 정상 지원
    const successApply = await request.post(`/api/exhibitions/${exId}/apply`)
      .set('Authorization', artistToken)
      .send({
        customAnswers: [
          { fieldId: 'q1', value: '추상적 도시풍경을 재해석한 작품입니다.' },
          { fieldId: 'q2', value: '1~3회' },
          { fieldId: 'q3', value: '' }, // optional, 비어있어도 OK
        ]
      });
    expect(successApply.status).toBe(201);

    // 9. DB에 customAnswers 확인
    const app = await testPrisma.application.findFirst({ where: { exhibitionId: exId, userId: 1 } });
    expect(app?.customAnswers).toBeTruthy();
    const answers = JSON.parse(app!.customAnswers!);
    expect(answers.find((a: any) => a.fieldId === 'q1').value).toContain('추상적');

    // 10. Gallery 오너가 커스텀 필드 수정
    const updateCf = await request.patch(`/api/exhibitions/${exId}/custom-fields`)
      .set('Authorization', galleryToken)
      .send({
        customFields: [
          { id: 'q1', label: '작품 컨셉 (상세)', type: 'textarea', required: true },
          { id: 'q4', label: '추가 질문', type: 'text', required: false },
        ]
      });
    expect(updateCf.status).toBe(200);
    expect(updateCf.body.customFields).toHaveLength(2);
    expect(updateCf.body.customFields[0].label).toBe('작품 컨셉 (상세)');

    // 11. 수정 후 상세 조회 반영 확인
    const detailAfter = await request.get(`/api/exhibitions/${exId}`);
    expect(detailAfter.body.customFields).toHaveLength(2);

    // 12. Artist 2가 수정된 필드 기준으로 지원
    const apply2 = await request.post(`/api/exhibitions/${exId}/apply`)
      .set('Authorization', artist2Token)
      .send({
        customAnswers: [
          { fieldId: 'q1', value: '색채의 대비를 통한 감정 표현' },
        ]
      });
    expect(apply2.status).toBe(201);

    // 13. 커스텀 필드 null로 제거
    const removeCf = await request.patch(`/api/exhibitions/${exId}/custom-fields`)
      .set('Authorization', galleryToken)
      .send({ customFields: null });
    expect(removeCf.status).toBe(200);
    expect(removeCf.body.customFields).toBeNull();

    // 14. 제거 후 상세 조회에서 null 확인
    const detailNull = await request.get(`/api/exhibitions/${exId}`);
    expect(detailNull.body.customFields).toBeNull();

    // 15. Artist는 custom-fields 수정 불가 (권한 없음)
    const artistEdit = await request.patch(`/api/exhibitions/${exId}/custom-fields`)
      .set('Authorization', artistToken)
      .send({ customFields: [{ id: 'x', label: 'hack', type: 'text', required: false }] });
    expect(artistEdit.status).toBe(403);
  });
});
