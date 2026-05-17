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

  await page.getByLabel(/Opacity floor/).hover();
  await expect(page.getByRole('tooltip')).toContainText(/Splats below this alpha/);
});

test('threshold sliders enter simplification preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Normal view/ })).toHaveClass(/active/);
  await page.getByRole('slider', { name: /Simplify/ }).fill('0.9');
  await expect(page.getByRole('button', { name: /Simplify view/ })).toHaveClass(/active/);
});

test('shows graceful unsupported file status', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByLabel('Load splat file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'bad.ksplat', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.getByText(/Unsupported file type/)).toBeVisible();
});
