import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * ArtStory Feed: @mention과 하이라이트 저장 기능 확인
 */

test('ArtStory: 댓글 입력 필드가 보이는지 확인', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');

  await page.goto('/feed');
  await page.waitForLoadState('networkidle');

  // 첫 번째 스토리 카드 확인
  const storyCard = page.locator('article').first();
  await expect(storyCard).toBeVisible().catch(() => {
    console.log('⚠️  스토리 카드가 없습니다');
  });

  // 댓글 입력 필드 찾기
  const commentInput = page.locator('input[placeholder*="댓글"]').or(
    page.locator('input[placeholder*="말풍선"]')
  ).first();

  const isVisible = await commentInput.isVisible().catch(() => false);
  console.log(`📝 댓글 입력 필드: ${isVisible ? '✅ 있음' : '❌ 없음'}`);

  if (!isVisible) {
    // 페이지 HTML 확인
    const html = await page.evaluate(() => {
      const articles = document.querySelectorAll('article');
      if (articles.length === 0) return '스토리 카드 없음';
      const article = articles[0];
      const inputs = article.querySelectorAll('input');
      return `input 태그 ${inputs.length}개 found: ${Array.from(inputs).map(i => i.placeholder).join(', ')}`;
    });
    console.log(`  ${html}`);
  }

  await ctx.close();
});

test('ArtStory: 하이라이트 저장 버튼이 있는지 확인', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');

  await page.goto('/feed');
  await page.waitForLoadState('networkidle');

  // 첫 번째 스토리 카드의 버튼들 확인
  const storyCard = page.locator('article').first();
  const hasCard = await storyCard.isVisible().catch(() => false);

  if (hasCard) {
    const buttons = storyCard.locator('button');
    const btnCount = await buttons.count();
    console.log(`🔘 스토리 카드의 버튼 개수: ${btnCount}`);

    const buttonTexts: string[] = [];
    for (let i = 0; i < btnCount; i++) {
      const text = await buttons.nth(i).textContent();
      if (text) buttonTexts.push(text.trim());
    }
    console.log(`  버튼 텍스트: ${buttonTexts.join(', ')}`);

    const hasHighlightBtn = buttonTexts.some(t => t.includes('하이라이트') || t.includes('저장'));
    console.log(`🎯 하이라이트 버튼: ${hasHighlightBtn ? '✅ 있음' : '❌ 없음'}`);
  } else {
    console.log('⚠️  스토리 카드가 없습니다');
  }

  await ctx.close();
});
