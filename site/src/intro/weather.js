// Real weather at our ship's position (Open-Meteo: free, no key) + looks for the 3D ocean.
// If the service can't be reached (no internet at the venue) we fall back to a clear day.

export const CONDITIONS = ['clear', 'cloudy', 'rain', 'fog'];
// what the presenter can pick under each mode (a clear night = just stars, the base of 'night')
export const DAY_OPTIONS = ['clear', 'cloudy', 'fog'];
export const NIGHT_OPTIONS = ['cloudy', 'rain', 'fog'];

// keep a weather inside what each mode offers: no rain by day
export function fitMode({ condition = 'clear', night = false, ...rest } = {}) {
  if (!night && condition === 'rain') condition = 'cloudy';
  return { ...rest, condition, night };
}
export const CONDITION_AR = { clear: 'صافٍ', cloudy: 'غائم', rain: 'ممطر', fog: 'ضباب' };

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';

// WMO weather code -> one of our four looks
function conditionOf(code, cloud) {
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if (code === 3 || (code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloudy';
  return cloud >= 60 ? 'cloudy' : 'clear';
}

async function getJson(url, ms = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeather(lat, lon) {
  const q = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`;
  const [w, m] = await Promise.allSettled([
    getJson(`${FORECAST}?${q}&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,is_day&timezone=auto`),
    getJson(`${MARINE}?${q}&current=wave_height`),
  ]);
  if (w.status !== 'fulfilled' || !w.value?.current) return null;
  const c = w.value.current;
  return {
    live: true,
    condition: conditionOf(c.weather_code, c.cloud_cover ?? 0),
    night: c.is_day === 0,
    tempC: c.temperature_2m,
    windKmh: c.wind_speed_10m,
    cloud: c.cloud_cover,
    waveM: m.status === 'fulfilled' ? m.value?.current?.wave_height ?? null : null,
  };
}

// ---------------------------------------------------------------- looks

// numbers and colours the scene eases toward (colours as hex ints)
const DAY = {
  clear: {
    skyTop: 0x134a82, skyHorizon: 0x6fa9c6, glow: 0xffd88f, sun: 1.0, cloud: 0.18, cloudLit: 0xf4f8fb, cloudDark: 0x9fb8ca,
    fog: 0x5f97b3, fogDensity: 0.0021, deep: 0x07365a, shallow: 0x1592ad, skyRefl: 0x7fb9d4, spec: 0xfff1cf,
    hemi: 1.2, key: 2.4, keyColor: 0xffe7c2, exposure: 1.08, rain: 0, stars: 0, foam: 0xd9f0f8, sheen: 1.0,
  },
  cloudy: {
    skyTop: 0x3a4d60, skyHorizon: 0x7a8d9c, glow: 0xc9cfd4, sun: 0.15, cloud: 0.8, cloudLit: 0xc3ccd4, cloudDark: 0x55636f,
    fog: 0x5f7383, fogDensity: 0.003, deep: 0x0a2738, shallow: 0x285a6b, skyRefl: 0x7c8f9c, spec: 0xcfd6dc,
    hemi: 0.95, key: 0.6, keyColor: 0xdfe6ec, exposure: 1.05, rain: 0, stars: 0, foam: 0xaebcc6, sheen: 0.15,
  },
  rain: {
    skyTop: 0x1f2b37, skyHorizon: 0x4a5a6b, glow: 0x9aa6b1, sun: 0, cloud: 1, cloudLit: 0x8794a0, cloudDark: 0x2c3843,
    fog: 0x394856, fogDensity: 0.0048, deep: 0x05182a, shallow: 0x18404f, skyRefl: 0x4d5d6b, spec: 0x9aa6b1,
    hemi: 0.75, key: 0.3, keyColor: 0xc9d3dc, exposure: 1.0, rain: 1, stars: 0, foam: 0x7d8c99, sheen: 0.0,
  },
  fog: {
    skyTop: 0x6f7f8c, skyHorizon: 0x9eacb6, glow: 0xe6e2d6, sun: 0.1, cloud: 0.45, cloudLit: 0xc9d1d7, cloudDark: 0x8996a0,
    fog: 0x93a2ad, fogDensity: 0.0095, deep: 0x123247, shallow: 0x3d6f7e, skyRefl: 0x9eacb6, spec: 0xe6e2d6,
    hemi: 1.0, key: 0.45, keyColor: 0xe6e2d6, exposure: 1.05, rain: 0, stars: 0, foam: 0xc2ccd3, sheen: 0.1,
  },
};

const NIGHT = {
  clear: {
    skyTop: 0x01030a, skyHorizon: 0x071423, glow: 0x9fb7d9, sun: 0, cloud: 0.06, cloudLit: 0x2a3a4e, cloudDark: 0x0b1420,
    fog: 0x07121f, fogDensity: 0.0026, deep: 0x020a14, shallow: 0x0a2a3c, skyRefl: 0x0f2438, spec: 0x5d7391,
    hemi: 0.35, key: 0.55, keyColor: 0x9fb7d9, exposure: 1.0, rain: 0, stars: 1, foam: 0x2c4258, sheen: 0.08,
  },
  cloudy: {
    skyTop: 0x060b12, skyHorizon: 0x172331, glow: 0x5a6b80, sun: 0, cloud: 0.85, cloudLit: 0x26323f, cloudDark: 0x0a1018,
    fog: 0x0e1824, fogDensity: 0.0032, deep: 0x020a12, shallow: 0x0c2433, skyRefl: 0x172331, spec: 0x6b7c90,
    hemi: 0.3, key: 0.25, keyColor: 0x8fa3bd, exposure: 1.0, rain: 0, stars: 0.12, foam: 0x223140, sheen: 0.08,
  },
  rain: {
    skyTop: 0x04080e, skyHorizon: 0x111b26, glow: 0x46556a, sun: 0, cloud: 1, cloudLit: 0x1d2833, cloudDark: 0x070c12,
    fog: 0x0b141e, fogDensity: 0.005, deep: 0x01070f, shallow: 0x0a1f2b, skyRefl: 0x111b26, spec: 0x55667a,
    hemi: 0.25, key: 0.15, keyColor: 0x8fa3bd, exposure: 1.0, rain: 1, stars: 0, foam: 0x1b2733, sheen: 0.08,
  },
  fog: {
    skyTop: 0x0f1822, skyHorizon: 0x26333f, glow: 0x6b7a8a, sun: 0, cloud: 0.4, cloudLit: 0x2c3946, cloudDark: 0x121b24,
    fog: 0x1f2b37, fogDensity: 0.009, deep: 0x041019, shallow: 0x123040, skyRefl: 0x26333f, spec: 0x6b7a8a,
    hemi: 0.35, key: 0.2, keyColor: 0x8fa3bd, exposure: 1.0, rain: 0, stars: 0, foam: 0x34424f, sheen: 0.08,
  },
};

// wave height (m) -> how tall our 3D waves are (1 = the original look)
export function waveScale(waveM, condition) {
  if (waveM == null) return condition === 'rain' ? 1.3 : 1;
  return Math.min(1.6, Math.max(0.55, 0.45 + waveM * 0.55));
}

export function lookFor({ condition = 'clear', night = false, waveM = null } = {}) {
  ({ condition, night } = fitMode({ condition, night }));
  const base = (night ? NIGHT : DAY)[condition] || DAY.clear;
  return { ...base, waves: waveScale(waveM, condition), night: night ? 1 : 0 };
}
