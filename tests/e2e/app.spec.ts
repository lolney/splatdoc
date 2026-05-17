import { expect, test } from '@playwright/test';

test('loads the diagnostic cockpit and switches modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SplatDoc' })).toBeVisible();
  await expect(page.getByText('generated-diagnostic-soup.splat')).toBeVisible();
  await page.getByRole('button', { name: 'Soup view' }).click();
  await expect(page.getByRole('button', { name: 'Soup view' })).toHaveClass(/active/);
  await expect(page.getByText('View Estimate')).toBeVisible();
});

test('shows graceful unsupported file status', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByLabel('Load splat file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'bad.ksplat', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByText(/Unsupported file type/)).toBeVisible();
});
