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
    await page.getByLabel('Airline code').fill('DL');
    await page.getByLabel('Flight number').fill('1437');
    await page.getByLabel('Departure airport').fill('JFK');
    await page.getByLabel('Arrival airport').fill('SEA');
    await page.getByLabel('Departure date').fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel('Departure time', {exact: false}).fill('14:35');
    await page.getByRole('button', {name: 'Find my flight'}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await page.getByRole('textbox', {name: 'Display name', exact: true}).fill('Taylor Test');
    await page.getByRole('switch', {name: /Show me as anonymous/}).check();
    await page.getByLabel('Baggage allowance (kg)').fill('20');
    await page.getByLabel('Expected baggage weight (kg)').fill('23');
    await page.getByRole('button', {name: 'Join flight room'}).click();
    await expect(page).toHaveURL(/\/flights\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', {name: 'DL 1437 flight room'})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', {name: 'DL 1437 flight room'})).toBeVisible();
    await expect(page.getByText('Anonymous Traveller (you)')).toBeVisible();
    await page.getByRole('button', {name: 'Edit baggage'}).click();
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
    await page.getByLabel('Flight code').fill('BA 117');
    await page.getByLabel('Departure date').fill(new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10));
    await page.getByRole('button', {name: 'Search flights'}).click();
    await expect(page.getByRole('heading', {name: 'Choose your flight'})).toBeVisible();
    await page.getByRole('button', {name: /BA 117, LHR to JFK/}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await expect(page.getByText(/mock|demo booking/i).last()).toBeVisible();
    await page.getByRole('textbox', {name: 'Display name', exact: true}).fill('Demo Guest');
    await page.getByRole('button', {name: 'Join flight room'}).click();
    await expect(page).toHaveURL(/\/flights\/[0-9a-f-]+$/);
    const profile = await page.request.get('/api/v1/profile');
    expect((await profile.json()).data.flyer.points).toBe(0);
    await page.goto('/onboarding?add=1');
    await page.getByRole('button', {name: 'Demo booking'}).click();
    await expect(page.getByText(/Do not enter real booking details/)).toBeVisible();
    await page.getByLabel('Demo booking reference').fill('DEMO12');
    await page.getByLabel('Demo surname').fill('Traveller');
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
    await page.getByLabel('Ticket text').fill(`Passenger: PRIVATE-SURNAME/ALEX\nBooking reference: ZXQ456\nFlight VA 883\nSYD → MEL\nDeparture: ${departureDate} 17:40`);
    await page.getByRole('button', {name: 'Import ticket'}).click();
    await expect(page.getByText(/Ticket text cleared/)).toBeVisible();
    await expect(page.getByRole('button', {name: 'Manual entry', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Airline code')).toHaveValue('VA');
    await expect(page.getByLabel('Flight number')).toHaveValue('883');
    await expect(page.getByLabel('Departure airport')).toHaveValue('SYD');
    await expect(page.getByLabel('Arrival airport')).toHaveValue('MEL');
    await expect(page.getByLabel('Departure date')).toHaveValue(departureDate);
    await expect(page.getByLabel('Departure time')).toHaveValue('17:40');
    expect(writes).toEqual([]);

    await page.getByRole('button', {name: 'Find my flight'}).click();
    const displayName = page.getByRole('textbox', {name: 'Display name', exact: true});
    await expect(displayName).toHaveValue('');
    await page.getByRole('button', {name: 'Use Alex', exact: true}).click();
    await expect(displayName).toHaveValue('Alex');
    await page.getByRole('button', {name: 'Join flight room'}).click();
    await expect(page.getByRole('heading', {name: 'VA 883 flight room'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Add baggage'})).toBeVisible();

    expect(writes.map(({path}) => path)).toEqual(['/api/v1/flights/verify', '/api/v1/auth/guest', '/api/v1/flights/verify', '/api/v1/flights/join']);
    const itinerary = {method: 'manual', airline: 'VA', flightNumber: '883', departureAirport: 'SYD', arrivalAirport: 'MEL', departureDate, departureTime: '17:40'};
    expect(JSON.parse(writes[0].body ?? '{}')).toEqual(itinerary);
    expect(JSON.parse(writes[1].body ?? '{}')).toEqual({});
    expect(JSON.parse(writes[2].body ?? '{}')).toEqual(itinerary);
    const join = JSON.parse(writes[3].body ?? '{}');
    expect(join.displayName).toBe('Alex');
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
    await route.fulfill({json: {data: {liveEnabled: true, liveError: code !== 'AS2223', items: code !== 'AS2223' ? [] : [
      {source: 'SCHEDULE', flight: {airline: 'AS', flightNumber: '2223', departureAirport: 'SEA', arrivalAirport: 'PDX', departureDate: date, departureTime: '13:00'}},
    ]}}});
  });
  await page.goto('/onboarding');
  try {
    await expectFlightEntry(page);
    await page.getByLabel('Flight code').fill('AS2223');
    await page.getByLabel('Departure date').fill(date);
    await page.getByRole('button', {name: 'Search flights'}).click();
    await expect(page.getByText('Published schedule', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: /AS 2223, SEA to PDX/}).click();
    await expect(page.getByRole('heading', {name: 'Make the room yours.'})).toBeVisible();
    await expect(page.getByText('Self-reported', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Edit flight'}).click();
    await page.getByLabel('Flight code').fill('AS2224');
    await page.getByRole('button', {name: 'Search flights'}).click();
    await expect(page.getByText(/Live schedules are temporarily unavailable/)).toBeVisible();
    await page.getByRole('button', {name: 'Enter flight details manually'}).click();
    await expect(page.getByLabel('Flight number')).toHaveValue('2224');
    await expect(page.getByLabel('Departure date')).toHaveValue(date);
  } finally { await cleanup(page); }
});