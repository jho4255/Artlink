import api from '@/lib/axios';
import { compressImage, MAX_IMAGE_BYTES } from '@/lib/utils';

/**
 * 프로필 사진 바꾸기 — 마이페이지 프로필 카드와 홈페이지 편집 [소개] 의 '프로필 사진' 이 같이 쓴다(2026-10-28).
 * 줄이고 → 올리고 → `PUT /auth/me/avatar`. 돌려주는 값은 새 사진 주소. 옛 사진 파일은 서버가 지운다.
 * 너무 크면 던진다(메시지는 화면에 그대로 띄울 수 있는 말).
 */
export async function uploadAvatar(rawFile: File): Promise<string> {
  const file = await compressImage(rawFile);
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`이미지 용량이 너무 큽니다. (최대 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`);
  }
  const formData = new FormData();
  formData.append('image', file);
  const up = await api.post('/upload/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  const url = up.data.url as string;
  await api.put('/auth/me/avatar', { avatar: url });
  return url;
}
