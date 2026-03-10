import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    // 각 테스트 전 상태 초기화
    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
  });

  it('초기 상태 — 비인증', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('login — 토큰과 유저 설정', () => {
    const user = { id: 1, name: 'Test', email: 'test@test.com', role: 'ARTIST' };
    useAuthStore.getState().login('test-token', user);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('test-token');
    expect(state.user?.email).toBe('test@test.com');
  });

  it('logout — 상태 초기화', () => {
    const user = { id: 1, name: 'Test', email: 'test@test.com', role: 'ARTIST' };
    useAuthStore.getState().login('test-token', user);
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
  });

  it('updateUser — 부분 업데이트', () => {
    const user = { id: 1, name: 'Test', email: 'test@test.com', role: 'ARTIST' };
    useAuthStore.getState().login('test-token', user);
    useAuthStore.getState().updateUser({ name: 'Updated Name', avatar: '/new.jpg' });

    const state = useAuthStore.getState();
    expect(state.user?.name).toBe('Updated Name');
    expect(state.user?.avatar).toBe('/new.jpg');
    expect(state.user?.email).toBe('test@test.com'); // 변경 안된 필드
  });
});
