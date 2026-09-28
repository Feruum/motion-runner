import { expect, test } from '@playwright/test';

test('switches between four animated KayKit runners before camera setup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/PropertyBinding|target node found/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('.');
  const picker = page.getByRole('group', { name: 'Choose your runner' });
  await expect(picker).toBeVisible({ timeout: 4000 });
  await expect(picker.getByRole('button', { name: 'Rogue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Knight', 'Mage', 'Barbarian', 'Rogue', 'Mage']) {
    await picker.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#game-world')).toHaveAttribute('data-character', name.toLowerCase());
    await expect(picker.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(1);
  }
  await page.screenshot({ path: 'test-results/character-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(picker.getByRole('button', { name: 'Barbarian', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/character-picker-mobile.png', fullPage: true });
  // Camera setup still starts normally, and the selector leaves the setup flow.
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(picker).toBeHidden();
  expect(errors).toEqual([]);
});

test('keeps the previous runner when an optional character cannot load', async ({ page }) => {
  await page.route('**/assets/character/Mage.glb', route => route.abort());
  await page.goto('.');
  const picker = page.getByRole('group', { name: 'Choose your runner' });
  await expect(page.locator('#game-world')).toHaveAttribute('data-character', 'rogue');
  await picker.getByRole('button', { name: 'Mage', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mage could not load' })).toBeVisible();
  await expect(page.locator('#game-world')).toHaveAttribute('data-character', 'rogue');
  await expect(picker.getByRole('button', { name: 'Rogue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', { name: 'Knight', exact: true }).click();
  await expect(page.locator('#game-world')).toHaveAttribute('data-character', 'knight');
});
