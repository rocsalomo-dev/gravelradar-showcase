/**
 * Domain types + Zod schemas for GravelRadar.
 *
 * These mirror the relational schema in `src/db/schema.ts` (§6 of PLAN.md) and
 * are the single source of truth for both the Drizzle-backed repository
 * (future, real Postgres) and the JSON-backed repository (MVP fallback used
 * when DATABASE_URL is not configured). Seed JSON in `data/seed/*.json` is
 * validated against these schemas at load time so the app fails loudly and
 * early if seed data drifts from the schema, instead of silently rendering
 * `undefined` in the UI.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums (§6 allowed values)
// ---------------------------------------------------------------------------

export const eventTypes = [
  "gravel_race",
  "stage_race",
  "ultra_race",
  "bikepacking",
] as const;
export const EventTypeSchema = z.enum(eventTypes);
export type EventType = z.infer<typeof EventTypeSchema>;

export const competitionLevels = [
  "recreational",
  "amateur",
  "competitive",
  "elite",
  "mixed",
] as const;
export const CompetitionLevelSchema = z.enum(competitionLevels);
export type CompetitionLevel = z.infer<typeof CompetitionLevelSchema>;

export const eventStatuses = [
  "active",
  "inactive",
  "cancelled",
  "archived",
  "unknown",
] as const;
export const EventStatusSchema = z.enum(eventStatuses);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const registrationStatuses = [
  "open",
  "opening_soon",
  "closed",
  "sold_out",
  "waitlist",
  "invite_only",
  "unknown",
] as const;
export const RegistrationStatusSchema = z.enum(registrationStatuses);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const editionStatuses = [
  "scheduled",
  "completed",
  "postponed",
  "cancelled",
  "unconfirmed",
] as const;
export const EditionStatusSchema = z.enum(editionStatuses);
export type EditionStatus = z.infer<typeof EditionStatusSchema>;

export const routeTypes = [
  "short",
  "medium",
  "long",
  "ultra",
  "bikepacking",
  "stage",
  "qualifier",
  "recreational",
] as const;
export const RouteTypeSchema = z.enum(routeTypes);
export type RouteType = z.infer<typeof RouteTypeSchema>;

export const difficulties = ["easy", "moderate", "hard", "extreme", "unknown"] as const;
export const DifficultySchema = z.enum(difficulties);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const surfaceTypes = [
  "gravel",
  "dirt",
  "paved",
  "forest_road",
  "grass",
  "sand",
  "rocky",
  "singletrack",
  "unknown",
] as const;
export const SurfaceTypeSchema = z.enum(surfaceTypes);
export type SurfaceType = z.infer<typeof SurfaceTypeSchema>;

export const sourceTypes = [
  "official_event_site",
  "organiser",
  "race_series",
  "calendar_directory",
  "registration_platform",
  "manual_entry",
  "other",
] as const;
export const SourceTypeSchema = z.enum(sourceTypes);
export type SourceTypeEnum = z.infer<typeof SourceTypeSchema>;

export const confidenceLevels = ["high", "medium", "low"] as const;
export const ConfidenceSchema = z.enum(confidenceLevels);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const eventTagSlugs = [
  "beginner_friendly",
  "pro_field",
  "uci_qualifier",
  "scenic",
  "mountainous",
  "fast_course",
  "technical",
  "desert",
  "alpine",
  "coastal",
  "self_supported",
  "multi_day",
  "mass_start",
  "navigation_required",
  "women_specific",
  "family_friendly",
] as const;
export const EventTagSchema = z.enum(eventTagSlugs);
export type EventTag = z.infer<typeof EventTagSchema>;

export const continents = [
  "Europe",
  "North America",
  "South America",
  "Africa",
  "Asia",
  "Oceania",
] as const;
export const ContinentSchema = z.enum(continents);
export type Continent = z.infer<typeof ContinentSchema>;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const OrganiserSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  website_url: z.string().nullable(),
  contact_email: z.string().nullable(),
  country_code: z.string().nullable(),
  logo_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Organiser = z.infer<typeof OrganiserSchema>;

export const EventSchema = z.object({
  id: z.string(),
  organiser_id: z.string(),
  name: z.string(),
  slug: z.string(),
  short_name: z.string().nullable(),
  summary: z.string(),
  full_description: z.string(),
  event_type: EventTypeSchema,
  competition_level: CompetitionLevelSchema,
  primary_country_code: z.string(),
  primary_region: z.string().nullable(),
  primary_city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  official_website_url: z.string(),
  hero_image_url: z.string().nullable(),
  logo_url: z.string().nullable(),
  photo_urls: z.array(z.string()).default([]),
  official_video_url: z.string().nullable().default(null),
  founded_year: z.number().nullable(),
  typical_month: z.number().min(1).max(12).nullable(),
  status: EventStatusSchema,
  is_featured: z.boolean(),
  is_verified: z.boolean(),
  tags: z.array(EventTagSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Event = z.infer<typeof EventSchema>;

export const EventEditionSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  year: z.number(),
  edition_name: z.string().nullable(),
  start_date: z.string().nullable(), // ISO date
  end_date: z.string().nullable(),
  timezone: z.string().nullable(),
  registration_open_date: z.string().nullable(),
  registration_close_date: z.string().nullable(),
  registration_status: RegistrationStatusSchema,
  // Required: point at the dedicated registration page if one exists, else
  // fall back to the official event site — but never a fabricated URL. Use
  // registration_status to convey "not open yet", not a missing/fake URL.
  registration_url: z.string(),
  results_url: z.string().nullable(),
  // Required: the host city is always stated on a real event page.
  start_city: z.string(),
  // Nullable: legitimately unknown for some editions (e.g. loop courses
  // where the finish isn't separately named, or not yet announced).
  finish_city: z.string().nullable(),
  // Required: derivable from the host city/country even when not spelled
  // out verbatim on the page — this is a geographic fact, not a guess.
  region: z.string(),
  country_code: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  participant_limit: z.number().nullable(),
  expected_participants: z.number().nullable(),
  actual_participants: z.number().nullable(),
  currency: z.string().nullable(),
  minimum_entry_price: z.number().nullable(),
  maximum_entry_price: z.number().nullable(),
  qualification_event: z.boolean(),
  qualification_series: z.string().nullable(),
  edition_status: EditionStatusSchema,
  source_url: z.string().nullable(),
  last_verified_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EventEdition = z.infer<typeof EventEditionSchema>;

export const EventRouteSchema = z.object({
  id: z.string(),
  // Routes belong to the event. Editions are optional overrides for years
  // where the organiser publishes a different course.
  event_id: z.string(),
  event_edition_id: z.string().nullable(),
  name: z.string(),
  route_type: RouteTypeSchema,
  distance_km: z.number(),
  elevation_gain_m: z.number().nullable(),
  elevation_loss_m: z.number().nullable(),
  estimated_duration_hours: z.number().nullable(),
  maximum_duration_hours: z.number().nullable(),
  // Nullable at the schema level only because ~3/4 of the existing
  // hand-curated routes predate this being tracked and haven't been
  // backfilled yet. New agent submissions must include it — enforced by the
  // auto-publish gate in scripts/ingest.ts, not here, since raising it to
  // schema-required here would break the existing seed data outright.
  gravel_percentage: z.number().min(0).max(100).nullable(),
  paved_percentage: z.number().min(0).max(100).nullable(),
  singletrack_percentage: z.number().min(0).max(100).nullable(),
  technical_difficulty: DifficultySchema,
  physical_difficulty: DifficultySchema,
  minimum_age: z.number().nullable(),
  unsupported: z.boolean(),
  gps_required: z.boolean(),
  // Required: the specific page this route/distance was described on.
  route_url: z.string(),
  gpx_url: z.string().nullable(),
  // Optional RideWithGPS route/collection link for this specific distance.
  // Nullable + default(null) so existing route records (which predate this
  // field) keep validating; populated by the enrichment apply step.
  ridewithgps_url: z.string().nullable().default(null),
  route_description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EventRoute = z.infer<typeof EventRouteSchema>;

export const EventSourceSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  event_edition_id: z.string().nullable(),
  source_type: SourceTypeSchema,
  source_name: z.string(),
  source_url: z.string(),
  retrieved_at: z.string(),
  last_checked_at: z.string(),
  confidence: ConfidenceSchema,
  notes: z.string().nullable(),
});
export type EventSource = z.infer<typeof EventSourceSchema>;

// ---------------------------------------------------------------------------
// Composed / view models used by the UI (joins done in the repository layer)
// ---------------------------------------------------------------------------

export interface EventWithDetails extends Event {
  organiser: Organiser;
  editions: EventEdition[];
  /** The edition the UI should show by default: next upcoming, else latest completed. */
  currentEdition: EventEdition | null;
  /** Edition-specific routes when published, otherwise reusable event routes. */
  routes: EventRoute[];
  sources: EventSource[];
}

export interface EventCardViewModel {
  slug: string;
  name: string;
  shortName: string | null;
  heroImageUrl: string | null;
  photoUrls: string[];
  eventType: EventType;
  competitionLevel: CompetitionLevel;
  countryCode: string;
  region: string | null;
  city: string;
  latitude: number;
  longitude: number;
  startDate: string | null;
  endDate: string | null;
  registrationStatus: RegistrationStatus;
  minDistanceKm: number | null;
  maxDistanceKm: number | null;
  maxElevationGainM: number | null;
  distancesKm: number[];
  tags: EventTag[];
  isFeatured: boolean;
  editionStatus: EditionStatus | null;
}

// ---------------------------------------------------------------------------
// Submit-event form
// ---------------------------------------------------------------------------

export const SubmitEventSchema = z.object({
  eventName: z.string().min(2, "Event name is required"),
  organiserName: z.string().min(2, "Organiser name is required"),
  websiteUrl: z.string().url("Enter a valid URL"),
  countryCode: z.string().min(2, "Country is required"),
  city: z.string().min(1, "City is required"),
  eventDate: z.string().min(1, "Date is required"),
  eventType: EventTypeSchema,
  routeDistances: z.string().min(1, "List at least one distance"),
  contactEmail: z.string().email("Enter a valid email"),
  notes: z.string().optional(),
});
export type SubmitEventInput = z.infer<typeof SubmitEventSchema>;

export const submissionStatuses = ["pending", "approved", "rejected"] as const;
export const SubmissionStatusSchema = z.enum(submissionStatuses);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;
