export function appOrigin() {
  return new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').origin;
}

export function localDeployment() {
  const {hostname, protocol} = new URL(appOrigin());
  return protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function canUseDevDelivery() {
  return localDeployment() && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_INSECURE_HTTP === 'true');
}

export function secureCookies() {
  return new URL(appOrigin()).protocol === 'https:';
}

export function validateRuntimeConfig() {
  for (const key of ['DATABASE_URL', 'REDIS_URL']) if (!process.env[key]) throw new Error(`${key} is required`);
  if (!secureCookies() && !canUseDevDelivery()) throw new Error('APP_ORIGIN must use HTTPS outside local development');
  if (process.env.FLIGHT_PROVIDER === 'mock' && !canUseDevDelivery()) throw new Error('Mock booking verification is restricted to local development');
}