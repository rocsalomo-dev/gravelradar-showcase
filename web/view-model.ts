import type { EventCardViewModel, EventWithDetails } from "@/types/domain";

/**
 * Builds the derived/indexed search fields described in brief §7
 * (next_edition_date, minimum/maximum_distance_km, maximum_elevation_gain_m,
 * active_registration_status, featured score, etc.) from a joined
 * `EventWithDetails`. With only 15 events these are computed on read; the
 * function names/shape are what a materialized DB view would later replace.
 */
export function toCardViewModel(detail: EventWithDetails): EventCardViewModel {
  const distances = detail.routes.map((r) => r.distance_km).filter((d): d is number => d != null);
  const elevations = detail.routes
    .map((r) => r.elevation_gain_m)
    .filter((e): e is number => e != null);

  return {
    slug: detail.slug,
    name: detail.name,
    shortName: detail.short_name,
    heroImageUrl: detail.hero_image_url,
    photoUrls: detail.photo_urls,
    eventType: detail.event_type,
    competitionLevel: detail.competition_level,
    countryCode: detail.currentEdition?.country_code ?? detail.primary_country_code,
    region: detail.currentEdition?.region ?? detail.primary_region,
    city: detail.currentEdition?.start_city ?? detail.primary_city,
    latitude: detail.currentEdition?.latitude ?? detail.latitude,
    longitude: detail.currentEdition?.longitude ?? detail.longitude,
    startDate: detail.currentEdition?.start_date ?? null,
    endDate: detail.currentEdition?.end_date ?? null,
    registrationStatus: detail.currentEdition?.registration_status ?? "unknown",
    minDistanceKm: distances.length ? Math.min(...distances) : null,
    maxDistanceKm: distances.length ? Math.max(...distances) : null,
    maxElevationGainM: elevations.length ? Math.max(...elevations) : null,
    distancesKm: [...distances].sort((a, b) => a - b),
    tags: detail.tags,
    isFeatured: detail.is_featured,
    editionStatus: detail.currentEdition?.edition_status ?? null,
  };
}

/** Featured score: featured flag first, then verified, then how soon the event is. Used for homepage ordering. */
export function featuredScore(detail: EventWithDetails): number {
  let score = 0;
  if (detail.is_featured) score += 1000;
  if (detail.is_verified) score += 100;
  const startDate = detail.currentEdition?.start_date;
  if (startDate) {
    const daysAway = (new Date(startDate).getTime() - Date.now()) / 86_400_000;
    if (daysAway >= 0) score += Math.max(0, 365 - daysAway) / 365 * 50;
  }
  return score;
}

export function locationSearchText(detail: EventWithDetails): string {
  return [
    detail.name,
    detail.short_name,
    detail.primary_city,
    detail.primary_region,
    detail.primary_country_code,
    detail.currentEdition?.start_city,
    detail.currentEdition?.region,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
