import type { DayOfWeek } from '../types.js';

export function getLocalDateInfo(timezone = 'Asia/Kolkata') {
  const now = new Date();
  let safeTz = timezone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(now);
  } catch {
    safeTz = 'Asia/Kolkata';
  }

  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    hour: 'numeric',
    hour12: false,
  });
  const hour = Number(hourFormatter.format(now)) % 24;

  let greeting = 'Good evening';
  if (hour >= 4 && hour < 12) greeting = 'Good morning';
  else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';

  const dateFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: safeTz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    weekday: 'short',
  });
  const shortDay = weekdayFormatter.format(now).toUpperCase().slice(0, 3) as DayOfWeek;

  return {
    greeting,
    formattedDate: dateFormatter.format(now),
    isoDate: isoDateFormatter.format(now),
    dayOfWeek: shortDay,
    timezone: safeTz,
  };
}

export function getCutoffIsoDate(range: string, referenceIsoDate: string): string | null {
  const daysMap: Record<string, number> = {
    '7D': 7,
    '30D': 30,
    '90D': 90,
    '6M': 180,
    '1Y': 365,
  };
  const days = daysMap[range];
  if (!days) return null;
  const d = new Date(`${referenceIsoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export function getLastNDates(endIsoDate: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(`${endIsoDate}T00:00:00Z`);
  for (let i = count - 1; i >= 0; i--) {
    const copy = new Date(d);
    copy.setUTCDate(copy.getUTCDate() - i);
    dates.push(copy.toISOString().slice(0, 10));
  }
  return dates;
}
