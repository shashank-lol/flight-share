import {expect, test, type Page} from '@playwright/test';

async function expectFlightEntry(page: Page) {
  await expect(page.getByRole('heading', {name: 'Find your flight.'})).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Search', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'Search flights'})).toBeVisible();
  expect((await page.context().cookies()).some(({name}) => name === 'flight_share_session')).toBe(false);
}

async function cleanup(page: Page) {
  await page.evaluate(() => fetch('/api/v1/profile', {method: 'DELETE'})).catch(() => {});
}

test('home to flight room without email: manual flight, preferences and baggage update', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 1, name: 'Share a ride. Explore baggage matches.', exact: true})).toBeVisible();
  await page.locator('.fs-hero-actions').getByRole('link', {name: 'Find My Flight'}).click();
  try {
    await expectFlightEntry(page);
    await page.getByRole('button', {name: 'Manual entry', exact: true}).click();
    await page.getByLabel('Airline code').fill('AI');
    await page.getByLabel('Flight number').fill('505');
    await page.getByLabel('Departure airport').fill('DEL');
    await page.getByLabel('Arrival airport').fill('BLR');
    await page.getByLabel('Departure date').fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel('Departure time', {exact: false}).fill('08:45');
    await page.getByRole('button', {name: 'Find my flight'}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await page.getByRole('textbox', {name: 'Display name', exact: true}).fill('Arjun Mehta');
    await page.getByRole('switch', {name: /Show me as anonymous/}).check();
    await expect(page.getByLabel('Baggage allowance (kg)')).toHaveCount(0);
    await page.getByRole('button', {name: 'Join flight room'}).click();
    await expect(page).toHaveURL(/\/flights\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', {name: 'Group chat', exact: true})).toBeVisible();
    await expect(page.getByRole('navigation', {name: 'Flight sections'}).getByRole('link', {name: 'Group chat'})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Your baggage', {exact: true})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', {name: 'Group chat', exact: true})).toBeVisible();
    await page.getByRole('textbox', {name: 'Your message'}).fill('Namaste! See you at the gate.');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(page.getByRole('log').getByText('Namaste! See you at the gate.')).toBeVisible();
    await page.getByRole('link', {name: 'Passengers', exact: true}).click();
    await expect(page.getByText('Anonymous Traveller (you)')).toBeVisible();
    await expect(page.getByText('Your baggage', {exact: true})).toHaveCount(0);
    await page.getByRole('link', {name: 'Baggage matches', exact: true}).click();
    await page.getByRole('button', {name: 'Add baggage'}).click();
    await page.getByRole('dialog').getByLabel('Baggage allowance (kg)', {exact: true}).fill('20');
    await page.getByRole('dialog').getByLabel('Expected baggage weight (kg)').fill('19');
    await page.getByRole('button', {name: 'Save baggage'}).click();
    await expect(page.getByText('Baggage updated')).toBeVisible();
    await expect(page.getByText('1 kg available', {exact: true})).toBeVisible();
    await page.getByRole('link', {name: 'Airline policy'}).click();
    await expect(page.getByText('Policy not confirmed')).toBeVisible();
  } finally { await cleanup(page); }
});

test('mobile demo booking is clearly labeled and rejects horizontal overflow', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/onboarding');
  try {
    await expectFlightEntry(page);
    await page.getByLabel('Flight code').fill('6E 203');
    await page.getByLabel('Departure date').fill(new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10));
    await page.getByRole('button', {name: 'Search flights'}).click();
    await expect(page.getByRole('heading', {name: 'Choose your flight'})).toBeVisible();
    await page.getByRole('button', {name: /6E 203, DEL to BOM/}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await expect(page.getByText(/mock|demo booking/i).last()).toBeVisible();
    await page.getByRole('button', {name: 'Use Aanya', exact: true}).click();
    await page.getByRole('button', {name: 'Join flight room'}).click();
    await expect(page).toHaveURL(/\/flights\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', {name: 'Group chat', exact: true})).toBeVisible();
    const bottomNav = page.getByRole('navigation', {name: 'Flight sections'});
    await expect(bottomNav.getByRole('link')).toHaveCount(6);
    const bounds = await bottomNav.boundingBox();
    const composer = await page.getByRole('textbox', {name: 'Your message'}).boundingBox();
    expect(bounds!.height).toBeLessThan(72);
    expect(bounds!.y + bounds!.height).toBeCloseTo(844, 0);
    expect(composer!.y + composer!.height).toBeLessThan(bounds!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const profile = await page.request.get('/api/v1/profile');
    expect((await profile.json()).data.flyer.points).toBe(0);
    await page.goto('/onboarding?add=1');
    await page.getByRole('button', {name: 'Demo booking'}).click();
    await expect(page.getByText(/Do not enter real booking details/)).toBeVisible();
    await page.getByLabel('Demo booking reference').fill('DEMO12');
    await page.getByLabel('Demo surname').fill('Sharma');
    await page.getByRole('button', {name: 'Find my flight'}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await expect(page.getByText(/mock|demo booking/i).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await cleanup(page); }
});

test('pasted ticket stays local until reviewed and can join without reporting baggage', async ({page}) => {
  const departureDate = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  await page.goto('/onboarding');
  try {
    await expectFlightEntry(page);
    const writes: {path: string; body: string | null}[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/v1/') && request.method() === 'POST') writes.push({path, body: request.postData()});
    });

    await page.getByRole('button', {name: 'Paste ticket'}).click();
    await page.getByLabel('Ticket text').fill(`Passenger: PRIVATE-SURNAME/PRIYA\nBooking reference: ZXQ456\nFlight 6E 203\nDEL → BOM\nDeparture: ${departureDate} 08:25`);
    await page.getByRole('button', {name: 'Import ticket'}).click();
    await expect(page.getByText(/Ticket text cleared/)).toBeVisible();
    await expect(page.getByRole('button', {name: 'Manual entry', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Airline code')).toHaveValue('6E');
    await expect(page.getByLabel('Flight number')).toHaveValue('203');
    await expect(page.getByLabel('Departure airport')).toHaveValue('DEL');
    await expect(page.getByLabel('Arrival airport')).toHaveValue('BOM');
    await expect(page.getByLabel('Departure date')).toHaveValue(departureDate);
    await expect(page.getByLabel('Departure time')).toHaveValue('08:25');
    expect(writes).toEqual([]);

    await page.getByRole('button', {name: 'Find my flight'}).click();
    const displayName = page.getByRole('textbox', {name: 'Display name', exact: true});
    await expect(displayName).toHaveValue('');
    await page.getByRole('button', {name: 'Use Priya', exact: true}).click();
    await expect(displayName).toHaveValue('Priya');
    await page.getByRole('button', {name: 'Join flight room'}).click();
    await expect(page.getByRole('heading', {name: 'Group chat', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Add baggage'})).toHaveCount(0);
    await page.getByRole('link', {name: 'Baggage matches', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Add baggage'})).toBeVisible();

    expect(writes.map(({path}) => path)).toEqual(['/api/v1/flights/verify', '/api/v1/auth/guest', '/api/v1/flights/verify', '/api/v1/flights/join']);
    const itinerary = {method: 'manual', airline: '6E', flightNumber: '203', departureAirport: 'DEL', arrivalAirport: 'BOM', departureDate, departureTime: '08:25'};
    expect(JSON.parse(writes[0].body ?? '{}')).toEqual(itinerary);
    expect(JSON.parse(writes[1].body ?? '{}')).toEqual({});
    expect(JSON.parse(writes[2].body ?? '{}')).toEqual(itinerary);
    const join = JSON.parse(writes[3].body ?? '{}');
    expect(join.displayName).toBe('Priya');
    expect(join).not.toHaveProperty('baggageAllowance');
    expect(join).not.toHaveProperty('expectedBaggageWeight');
    for (const {body} of writes) expect(body).not.toMatch(/PRIVATE-SURNAME|ZXQ456/i);
  } finally { await cleanup(page); }
});

test('published schedule moves a guest to profile setup and an outage preserves manual entry', async ({page}) => {
  const date = new Date(Date.now() + 16 * 86_400_000).toISOString().slice(0, 10);
  await page.route('**/api/v1/flights/search?*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) { await route.fulfill({response}); return; }
    const code = new URL(route.request().url()).searchParams.get('code');
    await route.fulfill({json: {data: {liveEnabled: true, liveError: code !== 'AI505', items: code !== 'AI505' ? [] : [
      {source: 'SCHEDULE', flight: {airline: 'AI', flightNumber: '505', departureAirport: 'DEL', arrivalAirport: 'BLR', departureDate: date, departureTime: '08:45'}},
    ]}}});
  });
  await page.goto('/onboarding');
  try {
    await expectFlightEntry(page);
    await page.getByLabel('Flight code').fill('AI505');
    await page.getByLabel('Departure date').fill(date);
    await page.getByRole('button', {name: 'Search flights'}).click();
    await expect(page.getByText('Published schedule', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: /AI 505, DEL to BLR/}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await expect(page.getByText('Self-reported', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Edit flight'}).click();
    await page.getByLabel('Flight code').fill('AI504');
    await page.getByRole('button', {name: 'Search flights'}).click();
    await expect(page.getByText(/Live schedules are temporarily unavailable/)).toBeVisible();
    await page.getByRole('button', {name: 'Enter flight details manually'}).click();
    await expect(page.getByLabel('Flight number')).toHaveValue('504');
    await expect(page.getByLabel('Departure date')).toHaveValue(date);
  } finally { await cleanup(page); }
});