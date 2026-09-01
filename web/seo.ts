import type { EditionStatus, EventWithDetails } from "@/types/domain";
import { countryName } from "@/lib/geo";

export const SITE_NAME = "GravelRadar";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://gravelradar.example.com";

export const SITE_DESCRIPTION =
  "Explore gravel races, bikepacking events and ultra-distance adventures around the world. Filter by date, location and distance.";

const SITEMAP_PAST_GRACE_DAYS = 14;
const SITEMAP_FUTURE_WINDOW_DAYS = 400;

interface PageMetadataInput {
  title: string;
  description: string;
  path: string;
  image?: string;
}

/**
 * Builds a Next.js Metadata-shaped object for a specific page, including
 * canonical URL + OpenGraph/Twitter overrides (brief §15).
 */
export function pageMetadata({ title, description, path, image }: PageMetadataInput) {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website" as const,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: "summary_large_image" as const,
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface ItemListEntry {
  name: string;
  url: string;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function itemListJsonLd(items: ItemListEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

export function faqJsonLd(faq: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

const SCHEMA_EVENT_STATUS: Record<EditionStatus, string> = {
  scheduled: "https://schema.org/EventScheduled",
  completed: "https://schema.org/EventScheduled",
  postponed: "https://schema.org/EventPostponed",
  cancelled: "https://schema.org/EventCancelled",
  unconfirmed: "https://schema.org/EventScheduled",
};

/**
 * Builds Schema.org `SportsEvent` structured data for an event detail page
 * (brief §15). Uses the current edition for dates/location/registration;
 * falls back gracefully when an edition field is unverified/null rather than
 * fabricating a value.
 */
export function eventJsonLd(detail: EventWithDetails) {
  const edition = detail.currentEdition;
  const countryCode = edition?.country_code ?? detail.primary_country_code;
  const latitude = edition?.latitude ?? detail.latitude;
  const longitude = edition?.longitude ?? detail.longitude;

  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: detail.name,
    description: detail.summary,
    url: `${SITE_URL}/events/${detail.slug}`,
    sport: "Cycling",
    ...(edition?.start_date ? { startDate: edition.start_date } : {}),
    ...(edition?.end_date ? { endDate: edition.end_date } : {}),
    ...(edition?.edition_status
      ? { eventStatus: SCHEMA_EVENT_STATUS[edition.edition_status] }
      : {}),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: [edition?.start_city ?? detail.primary_city, countryName(countryCode)]
        .filter(Boolean)
        .join(", "),
      address: {
        "@type": "PostalAddress",
        addressLocality: edition?.start_city ?? detail.primary_city,
        addressRegion: edition?.region ?? detail.primary_region ?? undefined,
        addressCountry: countryCode,
      },
      ...(latitude != null && longitude != null
        ? { geo: { "@type": "GeoCoordinates", latitude, longitude } }
        : {}),
    },
    organizer: {
      "@type": "Organization",
      name: detail.organiser.name,
      ...(detail.organiser.website_url ? { url: detail.organiser.website_url } : {}),
    },
    ...(edition?.registration_url
      ? {
          offers: {
            "@type": "Offer",
            url: edition.registration_url,
            availability:
              edition.registration_status === "open"
                ? "https://schema.org/InStock"
                : edition.registration_status === "sold_out"
                  ? "https://schema.org/SoldOut"
                  : "https://schema.org/PreOrder",
            ...(edition.minimum_entry_price != null
              ? { price: edition.minimum_entry_price, priceCurrency: edition.currency ?? "USD" }
              : {}),
          },
        }
      : {}),
  };
}

export function shouldIncludeEventInSitemap(
  detail: EventWithDetails,
  now = new Date(),
): boolean {
  if (detail.status !== "active") return false;

  const edition = detail.currentEdition;
  if (!edition?.start_date) return detail.is_featured || detail.is_verified;
  if (edition.edition_status === "cancelled") return false;

  const start = new Date(`${edition.start_date}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return detail.is_featured || detail.is_verified;

  const diffDays = Math.floor((start.getTime() - now.getTime()) / 86_400_000);

  if (diffDays < -SITEMAP_PAST_GRACE_DAYS) return false;
  if (diffDays <= SITEMAP_FUTURE_WINDOW_DAYS) return true;

  return detail.is_featured && detail.is_verified;
}
