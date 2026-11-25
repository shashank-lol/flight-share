import {expect, test, type Page} from '@playwright/test';
import {randomInt} from 'node:crypto';

const date = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const flight = {method: 'manual', airline: 'AI', flightNumber: String(randomInt(1000, 9999)), departureAirport: 'DEL', arrivalAirport: 'BLR', departureDate: date(randomInt(8, 360)), departureTime: '08:20'};

async function write<T>(page: Page, origin: string, path: string, value: object, method = 'POST'): Promise<T> {
  const response = await page.request.fetch(`/api/v1/${path}`, {method, data: value, headers: {origin}});
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as T;
}

async function join(page: Page, origin: string, displayName: string, weight?: number, itinerary = flight) {
  await write(page, origin, 'auth/guest', {});
  const {token} = await write<{token: string}>(page, origin, 'flights/verify', itinerary);
  const {id} = await write<{id: string}>(page, origin, 'flights/join', {token, displayName});
  if (weight !== undefined) await write(page, origin, 'profile/baggage', {flightId: id, baggageAllowance: 15, expectedBaggageWeight: weight}, 'PATCH');
  return id;
}

test('mobile baggage and cab acceptances stay private and reuse the passenger DM', async ({browser, baseURL}) => {
  const origin = new URL(baseURL!).origin;
  const guests = await Promise.all(Array.from({length: 3}, () => browser.newContext({baseURL, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})));
  const [aanya, arjun, priya] = await Promise.all(guests.map((guest) => guest.newPage()));
  try {
    const id = await join(aanya, origin, 'Aanya', 18);
    expect(await join(arjun, origin, 'Arjun', 11)).toBe(id);
    expect(await join(priya, origin, 'Priya', 17)).toBe(id);

    await aanya.goto(`/flights/${id}?tab=passengers`);
    await aanya.locator('article').filter({has: aanya.getByRole('heading', {name: 'Arjun', exact: true})}).getByRole('button', {name: 'Message', exact: true}).click();
    await expect(aanya).toHaveURL(/\/dashboard\/messages\/[0-9a-f-]+$/);
    const dm = new URL(aanya.url()).pathname;
    await aanya.getByRole('textbox', {name: 'Your message'}).fill('Namaste, Arjun. See you in Delhi!');
    await aanya.getByRole('button', {name: 'Send message'}).click();
    await expect(aanya.getByRole('log').getByText('Namaste, Arjun. See you in Delhi!')).toBeVisible();

    const baggage = `/flights/${id}?tab=matches`;
    await priya.goto(baggage);
    await expect(priya.getByRole('heading', {name: 'Arjun', exact: true})).toBeVisible();
    await aanya.goto(baggage);
    await aanya.locator('article').filter({has: aanya.getByRole('heading', {name: 'Arjun', exact: true})}).getByRole('button', {name: 'Send request'}).click();
    await expect(aanya.getByRole('region', {name: 'Your baggage requests'}).getByText('Request sent', {exact: true})).toBeVisible();
    await arjun.goto(baggage);
    await arjun.locator('article').filter({has: arjun.getByRole('heading', {name: 'Aanya', exact: true})}).getByRole('button', {name: 'Accept', exact: true}).click();
    await expect(arjun.getByText('Confirmed match', {exact: true})).toBeVisible();
    for (const page of [arjun, aanya]) {
      const links = page.getByRole('region', {name: 'Your baggage requests'}).getByRole('link', {name: 'Open chat'});
      await expect.poll(async () => [...new Set(await links.evaluateAll((items) => items.map((item) => item.getAttribute('href'))))]).toEqual([dm]);
    }
    await arjun.goto(dm);
    await expect(arjun.getByRole('log').getByText('Namaste, Arjun. See you in Delhi!')).toBeVisible();
    await priya.reload();
    await expect(priya.getByRole('heading', {name: 'No potential matches right now'})).toBeVisible();
    await expect(priya.getByRole('heading', {name: 'Arjun', exact: true})).toHaveCount(0);
    await expect(priya.getByText('Confirmed match', {exact: true})).toHaveCount(0);

    // Exercise cab acceptance for the same pair. The separate cab scenario
    // below covers the publish, request and accept controls in the browser.
    const listing = await write<{id: string}>(arjun, origin, `flights/${id}/rides`, {pickupArea: 'Dwarka Sector 21, Delhi', freeSeats: 1});
    const request = await write<{id: string}>(aanya, origin, `flights/${id}/rides/${listing.id}/requests`, {seats: 1, window: 20});
    const accepted = await write<{conversationId: string}>(arjun, origin, `flights/${id}/ride-requests/${request.id}`, {action: 'accept'}, 'PATCH');
    expect(`/dashboard/messages/${accepted.conversationId}`).toBe(dm);
    await aanya.goto(`/flights/${id}?tab=rides`);
    await expect(aanya.getByText('Your baggage', {exact: true})).toHaveCount(0);
    await aanya.goto(`/flights/${id}`);
    const groupLog = aanya.getByRole('log');
    await expect(aanya.getByRole('heading', {name: 'No group messages yet'})).toBeVisible();
    await expect(groupLog.getByText('Namaste, Arjun. See you in Delhi!')).toHaveCount(0);
    await aanya.goto(`/flights/${id}?tab=messages`);
    await expect(aanya).toHaveURL(/\/dashboard\/messages$/);
    await expect(aanya.locator(`a[href="${dm}"]`)).toHaveCount(1);
  } finally {
    for (const page of [aanya, arjun, priya]) await page.request.delete('/api/v1/profile', {headers: {origin}}).catch(() => {});
    await Promise.all(guests.map((guest) => guest.close()));
  }
});

test('My flights puts past trips under More and keeps their rooms reachable', async ({page, baseURL}) => {
  const origin = new URL(baseURL!).origin;
  await page.setViewportSize({width: 390, height: 844});
  try {
    const id = await join(page, origin, 'Priya', undefined, {...flight, flightNumber: '9834'});
    await page.goto(`/flights/${id}`);
    await page.getByRole('textbox', {name: 'Your message'}).fill('See you at Delhi Airport.');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(page.getByRole('log').getByText('See you at Delhi Airport.')).toBeVisible();

    // Simulate the profile classification changing without altering room membership.
    await page.route('**/api/v1/profile?refresh=arrivals', async (route) => {
      const response = await route.fetch();
      const {data} = await response.json();
      await route.fulfill({response, json: {data: {...data, pastFlights: data.flights, flights: []}}});
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', {name: 'My flights', exact: true})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Add flight', exact: true})).toHaveCount(1);
    await expect(page.getByRole('heading', {name: 'No active flights', exact: true})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Past flights', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'More flight options'}).click();
    await page.getByRole('link', {name: 'Past flights', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Past flights', exact: true})).toBeVisible();
    await page.getByRole('link', {name: /Open AI 9834/}).click();
    await expect(page.getByRole('log').getByText('See you at Delhi Airport.')).toBeVisible();
  } finally {
    await page.request.delete('/api/v1/profile', {headers: {origin}}).catch(() => {});
  }
});

test('mobile cab seats can be posted, found with a wider window and accepted', async ({browser, baseURL}) => {
  const origin = new URL(baseURL!).origin;
  const guests = await Promise.all(Array.from({length: 2}, () => browser.newContext({baseURL, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})));
  const [host, rider] = await Promise.all(guests.map((guest) => guest.newPage()));
  try {
    const hostFlight = await join(host, origin, 'Meera', undefined, {...flight, flightNumber: '9832', departureTime: '09:10'});
    const riderFlight = await join(rider, origin, 'Kabir', undefined, {...flight, flightNumber: '9833', departureTime: '08:25'});
    await host.goto(`/flights/${hostFlight}`);
    await host.getByRole('link', {name: 'Cabs', exact: true}).click();
    await host.getByRole('button', {name: 'Post cab listing'}).click();
    const editor = host.getByRole('dialog');
    await editor.getByLabel('Pickup area').fill('Connaught Place, New Delhi');
    await editor.getByLabel('Free seats to offer').fill('2');
    await editor.getByRole('button', {name: 'Publish listing'}).click();
    await expect(host.getByRole('heading', {name: /Your listing: Connaught Place/})).toBeVisible();

    await rider.goto(`/flights/${riderFlight}?tab=rides`);
    const window = rider.getByRole('spinbutton', {name: 'Departure window (minutes)'});
    await expect(window).toHaveValue('20');
    await expect(window).toHaveAttribute('min', '0');
    await expect(window).toHaveAttribute('max', '60');
    await expect(rider.getByRole('heading', {name: 'No cab listings in this window'})).toBeVisible();
    await rider.getByRole('button', {name: 'Increase departure window by 5 minutes'}).click();
    await expect(window).toHaveValue('25');
    await rider.getByRole('button', {name: 'Decrease departure window by 5 minutes'}).click();
    await expect(window).toHaveValue('20');
    await window.fill('45');
    await rider.getByRole('button', {name: 'Apply window'}).click();
    await expect(rider.getByRole('heading', {name: 'Connaught Place, New Delhi'})).toBeVisible();
    await rider.getByRole('button', {name: 'Request seats'}).click();
    const request = rider.getByRole('dialog');
    await request.getByLabel('How many seats?').fill('2');
    await request.getByRole('button', {name: 'Send seat request'}).click();
    await rider.getByRole('button', {name: 'Sent requests'}).click();
    await expect(rider.getByText('Pending', {exact: true})).toBeVisible();

    await host.getByRole('button', {name: 'Received requests'}).click();
    await host.getByRole('button', {name: 'Accept', exact: true}).click();
    await expect(host.getByText('0 seats available · 2 seats accepted')).toBeVisible();
    const hostChat = host.getByRole('link', {name: 'Open chat'});
    await expect(hostChat).toBeVisible();
    await expect(rider.getByRole('link', {name: 'Open chat'})).toHaveAttribute('href', (await hostChat.getAttribute('href'))!);
    await rider.getByRole('link', {name: 'Open chat'}).click();
    await expect(rider.getByRole('heading', {name: 'Meera'})).toBeVisible();
    expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    for (const page of [host, rider]) await page.request.delete('/api/v1/profile', {headers: {origin}}).catch(() => {});
    await Promise.all(guests.map((guest) => guest.close()));
  }
});