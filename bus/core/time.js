// Common service-day time parser; GTFS hours may exceed 24.
export function clockSeconds(value) {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value || '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}
