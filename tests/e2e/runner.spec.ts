import { expect, test } from '@playwright/test';

test('presents the complete starting experience and adapts to a narrow display', async ({ page }) => {
  const runtimeErrors: string[] = [];
  const animationBindingWarnings: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
    if (message.type() === 'warning' && /PropertyBinding|target node found/i.test(message.text())) animationBindingWarnings.push(message.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/Motion Runner/);
  await expect(page.getByRole('heading', { name: 'Move into play.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A little room to move.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-runner-assets', 'Rogue runner + KayKit track + animations loaded');
  await expect(page.locator('body')).toHaveAttribute('data-runner-animations', 'Idle,Running_A,Jump_Full_Short,Hit_A,Cheer');
  await expect(page.locator('.privacy-label')).toHaveText('LOCAL ONLY');
  await expect(page.getByText('Only your best score is saved.', { exact: false })).toBeVisible();
  await expect(page.getByText('Lean left')).toBeVisible();
  await expect(page.getByText('Lean right')).toBeVisible();
  await expect(page.getByText('Hands up')).toBeVisible();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/motion-runner-welcome.png', fullPage: true });
  expect(runtimeErrors).toEqual([]);
  expect(animationBindingWarnings).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.game-panel')).toBeVisible();
  await expect(page.locator('.camera-card')).toBeVisible();
  await expect(page.locator('.coach-card')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('loads the local camera model, WASM and KayKit models from the production build', async ({ page }) => {
  const assetResponses = new Map<string, number>();
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes('/models/') || pathname.includes('/wasm/') || pathname.includes('/assets/character/') || pathname.includes('/assets/platformer/') || pathname.includes('/assets/animations/')) {
      assetResponses.set(pathname, response.status());
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const fakeCamera = document.createElement('canvas');
        fakeCamera.width = 640;
        fakeCamera.height = 480;
        const context = fakeCamera.getContext('2d');
        if (context) {
          context.fillStyle = '#243a40';
          context.fillRect(0, 0, fakeCamera.width, fakeCamera.height);
        }
        return fakeCamera.captureStream(24);
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByRole('heading', { name: 'Stand tall and easy.' })).toBeVisible({ timeout: 30000 });
  await expect.poll(() => [...assetResponses.keys()].some(path => path.endsWith('/pose_landmarker_lite.task'))).toBe(true);
  await expect.poll(() => [...assetResponses.keys()].some(path => path.startsWith('/wasm/') && path.endsWith('.wasm'))).toBe(true);
  await expect.poll(() => assetResponses.has('/assets/character/Rogue_Hooded.glb')).toBe(true);
  await expect.poll(() => assetResponses.has('/assets/platformer/blue/platform_4x4x1_blue.gltf')).toBe(true);
  await expect.poll(() => assetResponses.has('/assets/animations/Rig_Medium_MovementBasic.glb')).toBe(true);
  await expect.poll(() => assetResponses.has('/assets/animations/Rig_Medium_General.glb')).toBe(true);
  await expect.poll(() => assetResponses.has('/assets/animations/Rig_Medium_Simulation.glb')).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-runner-assets', 'Rogue runner + KayKit track + animations loaded');
  await expect(page.locator('body')).toHaveAttribute('data-runner-animations', 'Idle,Running_A,Jump_Full_Short,Hit_A,Cheer');
  for (const [path, status] of assetResponses) expect(status, `${path} should be served`).toBe(200);
  await expect(page.getByText('BODY TRACKED')).not.toBeVisible();
  await expect(page.locator('#camera-status')).toContainText('STEP BACK INTO FRAME');
});
