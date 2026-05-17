import { expect, test } from '@playwright/test';

test('loads the diagnostic cockpit and switches modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SplatDoc' })).toBeVisible();
  await expect(page.getByText('generated-diagnostic-soup.splat')).toBeVisible();
  await page.getByRole('button', { name: 'Soup view' }).click();
  await expect(page.getByRole('button', { name: 'Soup view' })).toHaveClass(/active/);
  await expect(page.getByText('View Estimate')).toBeVisible();
});

test('explains diagnostic controls with tooltips', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Opacity view/ }).hover();
  await expect(page.getByRole('tooltip')).toContainText(/Maps each splat by alpha contribution/);

  await page.getByRole('button', { name: /Opacity view/ }).click();
  await page.getByRole('slider', { name: /Opacity floor/ }).hover();
  await expect(page.getByRole('tooltip')).toContainText(/Splats below this alpha/);
});

test('threshold sliders drive simplification preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Normal view/ })).toHaveClass(/active/);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('button', { name: /Opacity view/ }).click();
  await expect(page.getByRole('slider')).toHaveCount(1);
  await page.getByRole('slider', { name: /Opacity floor/ }).fill('0.5');
  await expect(page.getByRole('button', { name: /Opacity view/ })).toHaveClass(/active/);
  await page.getByRole('button', { name: /Simplify view/ }).click();
  await expect(page.getByRole('button', { name: /Simplify view/ })).toHaveClass(/active/);
  await expect(page.getByRole('slider')).toHaveCount(7);
  await expect(page.locator('.metric-row').filter({ hasText: 'Flagged' }).locator('strong')).toHaveText(/^[4-7],\d{3}$/);
});

test('simplify remains visible when every threshold is active', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Simplify view/ }).click();
  await expect(page.getByRole('slider')).toHaveCount(7);
  await page.getByRole('slider', { name: /Opacity floor/ }).fill('0.05');
  await page.getByRole('slider', { name: /Density cutoff/ }).fill('0.05');
  await page.getByRole('slider', { name: /Overdraw cutoff/ }).fill('0.05');
  await page.getByRole('slider', { name: /Size cutoff/ }).fill('0.05');
  await page.getByRole('slider', { name: /Outlier cutoff/ }).fill('0.51');
  await page.getByRole('slider', { name: /Dead cutoff/ }).fill('0.05');
  await page.getByRole('slider', { name: /Soup cutoff/ }).fill('0.05');

  const litRatio = await page.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const probe = document.createElement('canvas');
    probe.width = Math.min(320, canvas.width || canvas.clientWidth);
    probe.height = Math.min(220, canvas.height || canvas.clientHeight);
    const context = probe.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 18) lit++;
    }
    return lit / (data.length / 4);
  });
  expect(litRatio).toBeGreaterThan(0.2);
});

test('shows graceful unsupported file status', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByLabel('Load splat file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'bad.ksplat', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByText(/Unsupported file type/)).toBeVisible();
});
