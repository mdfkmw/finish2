export type GoogleMapsUrls = {
  embed: string
  direct: string
}

function normalizeCoordinate(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(6)
}

export function buildGoogleMapsUrls(
  lat: number | null | undefined,
  lng: number | null | undefined,
): GoogleMapsUrls | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null
  const latNum = Number(lat)
  const lngNum = Number(lng)
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null
  const latStr = normalizeCoordinate(latNum)
  const lngStr = normalizeCoordinate(lngNum)
  const coords = `${latStr},${lngStr}`
  return {
    embed: `https://www.google.com/maps?output=embed&q=${coords}&z=16`,
    direct: `https://www.google.com/maps?q=${coords}&z=17`,
  }
}
