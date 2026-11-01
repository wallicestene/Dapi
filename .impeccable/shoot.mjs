// Screenshots of the front door for design review: node .impeccable/shoot.mjs <outDir>
import { chromium } from 'playwright';
const out = process.argv[2];
const base = 'http://localhost:3000';
const browser = await chromium.launch();
async function shot(name, url, { width = 1440, height = 900, act } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + url, { waitUntil: 'networkidle' });
  if (act) await act(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}
await shot('home', '/');
await shot('job-run', '/jobs/0001');
await shot('job-receipt', '/jobs/0001', {
  act: async (p) => {
    await p.getByRole('radio', { name: /Exceptions/ }).click();
    await p.waitForTimeout(800);
    await p.locator('button[aria-label^="Legal Reference"]').first().click();
    await p.waitForTimeout(3000);
    await p.getByRole('button', { name: 'Re-check the seal' }).click().catch(() => {});
    await p.waitForTimeout(1500);
  },
});
await shot('job-site', '/jobs/0001', { act: async (p) => { await p.getByRole('tab', { name: /Site/ }).click(); } });
await shot('job-samples', '/jobs/0001', { act: async (p) => { await p.getByRole('tab', { name: /Samples/ }).click(); } });
await shot('job-footed', '/jobs/0001', { act: async (p) => { await p.getByRole('tab', { name: /Footed/ }).click(); } });
await shot('new', '/jobs/new');
await shot('job-phone', '/jobs/0001', { width: 390, height: 844 });
await browser.close();
