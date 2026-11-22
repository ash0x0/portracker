import assert from 'node:assert/strict';
import { createRegistryHistoryFixture } from './registry-history-fixture.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=',
  'base64'
);

export async function appearanceBrowserContracts(context, options) {
  const { records, urlPattern, handleRegistryRequest } = createRegistryHistoryFixture();
  for (const index of [78, 81, 95]) {
    records[index].pinned = true;
    records[index].pinnedAt = records[index].lastSeenAt;
  }
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => localStorage.setItem('portrackerActiveView', 'pinned'));
  await page.route(urlPattern, handleRegistryRequest);
  try {
    await page.goto(options.baseUrl + '/?server=local', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Pinned services' }).waitFor();
    let group = page.getByRole('button', { name: 'demo-group service group' });
    await group.click();

    await page.getByRole('button', { name: 'Edit Compose project appearance' }).click();
    const projectForm = page.getByRole('form', { name: 'Edit Compose group appearance' });
    await projectForm.getByRole('textbox', { name: 'Display name' }).fill('Personal infrastructure');
    await projectForm.getByRole('radio', { name: 'Terminal' }).check();
    await projectForm.getByRole('button', { name: 'Save appearance' }).click();
    await projectForm.waitFor({ state: 'hidden' });
    group = page.getByRole('button', { name: 'Personal infrastructure service group' });
    await group.waitFor();
    assert.equal(records[78].displayName, 'example-service-78');
    assert.equal(records[81].displayName, 'example-service-81');
    assert.equal(records[78].appearance.icon.type, 'automatic');

    await page.getByRole('button', { name: 'Edit selected service' }).click();
    const serviceForm = page.getByRole('form', { name: 'Edit service appearance' });
    const input = serviceForm.getByRole('textbox', { name: 'Display name' });
    await input.fill('My service');
    await page.getByRole('button', { name: 'Reload list', exact: true }).click();
    assert.equal(await input.inputValue(), 'My service');
    assert.equal(await group.getAttribute('aria-expanded'), 'true');
    await serviceForm.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(records[78].displayName, 'example-service-78');

    await page.getByRole('button', { name: 'Edit selected service' }).click();
    await serviceForm.getByRole('textbox', { name: 'Display name' }).fill('My service');
    await serviceForm.getByRole('radio', { name: 'Code editor' }).check();
    await serviceForm.getByRole('button', { name: 'Save appearance' }).click();
    await serviceForm.waitFor({ state: 'hidden' });
    assert.equal(records[78].displayName, 'My service');
    assert.equal(records[81].displayName, 'example-service-81');
    assert.equal(records[78].appearance.icon.name, 'editor');
    assert.equal(await page.getByRole('button', { name: 'Personal infrastructure service group' }).count(), 1);

    await page.getByRole('button', { name: 'Edit selected service' }).click();
    const conflictRoute = '**/api/service-registry/history-fixture-78/appearance';
    await page.route(conflictRoute, route => route.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'Concurrent appearance change' }),
    }));
    await serviceForm.getByRole('textbox', { name: 'Display name' }).fill('Keep this draft');
    await serviceForm.getByRole('button', { name: 'Save appearance' }).click();
    await serviceForm.getByRole('alert').getByText(/Appearance changed/).waitFor();
    assert.equal(await serviceForm.getByRole('textbox', { name: 'Display name' }).inputValue(),
      'Keep this draft');
    await page.unroute(conflictRoute);
    records[78].appearance.revision += 1;
    records[78].appearanceRevision = records[78].appearance.revision;
    await serviceForm.getByRole('button', { name: 'Reload latest and discard draft' }).click();
    await serviceForm.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Edit selected service' }).click();
    await serviceForm.getByLabel('Upload custom appearance icon').setInputFiles({
      name: 'sample.png', mimeType: 'image/png', buffer: PNG,
    });
    await serviceForm.getByAltText('New selected image preview').waitFor();
    await serviceForm.getByRole('button', { name: 'Save appearance' }).click();
    await serviceForm.waitFor({ state: 'hidden' });
    assert.equal(records[78].appearance.icon.type, 'upload');
    await page.locator('img[title="User-selected uploaded icon"]').first().waitFor();

    await page.getByRole('button', { name: 'Edit selected service' }).click();
    await serviceForm.getByRole('button', { name: 'Reset name' }).click();
    await serviceForm.getByRole('button', { name: 'Save appearance' }).click();
    await serviceForm.waitFor({ state: 'hidden' });
    assert.equal(records[78].displayName, 'example-service-78');
    assert.equal(records[78].appearance.icon.type, 'upload');
    await page.getByRole('button', { name: 'Edit selected service' }).click();
    await serviceForm.getByRole('button', { name: 'Reset icon' }).click();
    await serviceForm.getByRole('button', { name: 'Save appearance' }).click();
    await serviceForm.waitFor({ state: 'hidden' });
    assert.equal(records[78].appearance.icon.type, 'automatic');

    await page.reload({ waitUntil: 'domcontentloaded' });
    group = page.getByRole('button', { name: 'Personal infrastructure service group' });
    await group.waitFor();
    await group.click();
    await page.getByRole('button', { name: 'Edit Compose project appearance' }).click();
    await projectForm.getByRole('textbox', { name: 'Display name' }).fill('Discard by Escape');
    await projectForm.getByRole('textbox', { name: 'Display name' }).press('Escape');
    await projectForm.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Personal infrastructure service group' }).count(), 1);
    const nativeGroup = page.getByRole('button', { name: 'example-service-95 service group' });
    await nativeGroup.click();
    await page.getByRole('button', { name: 'Edit appearance', exact: true }).click();
    const nativeForm = page.getByRole('form', { name: 'Edit service appearance' });
    const nativeName = nativeForm.getByRole('textbox', { name: 'Display name' });
    assert.equal(await nativeName.evaluate(el => document.activeElement === el), true);
    await nativeName.fill('Home utility');
    await nativeForm.getByRole('radio', { name: 'Database' }).check();
    await nativeForm.getByRole('button', { name: 'Save appearance' }).click();
    await nativeForm.waitFor({ state: 'hidden' });
    assert.equal(records[95].displayName, 'Home utility');
    assert.equal(records[95].appearance.icon.name, 'database');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Home utility service group' }).waitFor();
  } finally {
    await page.evaluate(() => localStorage.setItem('portrackerActiveView', 'live'))
      .catch(() => undefined);
    await page.close();
  }
}
