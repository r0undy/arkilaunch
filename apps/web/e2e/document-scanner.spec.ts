import { test, expect } from '@playwright/test';

test('document scanner detects and straightens a clear page in the browser', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    const scanner = await import('/src/lib/document-scanner.ts');
    const cv = await scanner.loadDocumentScanner();
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#777';
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = '#f8f8f8';
    context.fillRect(90, 55, 460, 370);
    context.fillStyle = '#222';
    context.font = 'bold 25px sans-serif';
    for (let line = 0; line < 8; line++) context.fillText('COMPANY REGISTRATION 12345', 110, 110 + line * 34);
    const found = scanner.analyzeDocument(cv, context.getImageData(0, 0, 640, 480));
    if (!found) return null;
    const corrected = await scanner.straightenDocument(canvas, found.corners);
    return { quality: found.quality, corners: found.corners, size: corrected.size, type: corrected.type };
  });
  expect(result).not.toBeNull();
  expect(result?.quality).toBe('ready');
  expect(result?.corners).toHaveLength(4);
  expect(result?.size).toBeGreaterThan(1000);
  expect(result?.type).toBe('image/jpeg');
});
