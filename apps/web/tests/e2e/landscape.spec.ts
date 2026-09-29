import { expect, test } from '@playwright/test';

test('loads the authored KayKit landscape from local assets', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().includes('/environment/')) failures.push(request.url());
  });
  await page.goto('.');
  const canvas = page.locator('#game-world');
  await expect(canvas).toHaveAttribute('data-environment', 'ready');
  await expect(canvas).toHaveAttribute('data-environment-models', '18');
  await expect(canvas).toHaveAttribute('data-biome', 'Sunlit Valley');
  await expect(page.locator('#route-name')).toContainText('SUNLIT VALLEY');
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  expect(failures).toEqual([]);
  await page.screenshot({ path: 'test-results/landscape-welcome.png', fullPage: true });
});

test('keeps camera setup and runner selection available if scenery fails', async ({ page }) => {
  await page.route('**/assets/environment/catalog.json', route => route.abort());
  await page.goto('.');
  await expect(page.locator('#game-world')).toHaveAttribute('data-environment', 'unavailable');
  await page.getByRole('button', { name: 'Knight', exact: true }).click();
  await expect(page.locator('#game-world')).toHaveAttribute('data-character', 'knight');
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeEnabled();
});
