// Promoting a Hall of Fame moment to canon.
//
// Corn Planet Party never writes to the CPI Database, and promotion does not change that. A
// moderator gets a link to the Records Division with the incident form filled in; a person reviews
// it and files it under their own account. The filed record carries a marker ("cpp-moment-42"), and
// when the party server next reads canon it sees the marker and links the moment to its new record.
//
// So a moment is only ever shown as canon once the record really exists in the CPI Database.

import type { CanonService } from "./canon.ts";
import type { Moment, PartyDb } from "./db.ts";

const MARKER = /^cpp-moment-([1-9]\d{0,9})$/;
const TITLE_MAX = 90;

/** The marker a record filed from moment `id` carries in its `promotedFrom` field. */
export function promotionMarker(momentId: number): string {
  return `cpp-moment-${momentId}`;
}

/** The moment id a marker points at, or null for anything that isn't one of ours. */
export function momentIdFromMarker(marker: string | undefined): number | null {
  const match = MARKER.exec(marker ?? "");
  return match ? Number(match[1]) : null;
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max - 25 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A Records Division link that opens the incident form prefilled with this moment. The incident is
 * the prompt the agents were answering; the accepted report is how it was resolved. The person
 * filing it writes the incident report itself and can change any of this before filing.
 */
export function promotionUrl(moment: Moment, siteUrl: string): string {
  const url = new URL(`${siteUrl.replace(/\/+$/, "")}/records.html`);
  url.searchParams.set("promote", promotionMarker(moment.id));
  url.searchParams.set("title", shorten(moment.context, TITLE_MAX));
  url.searchParams.set("summary", moment.context);
  url.searchParams.set("resolution", moment.text);
  url.searchParams.set(
    "addendum",
    `Report filed by ${moment.authorName} during a Corn Planet Party session and accepted by ` +
      `${moment.votes} of ${moment.votesPossible} on the review board. ` +
      `Promoted to canon from the Hall of Fame (moment #${moment.id}).`,
  );
  return url.toString();
}

/**
 * Links moments to the canon records filed from them. Run after every canon refresh. Returns how
 * many moments became canon on this pass.
 */
export function reconcilePromotions(db: PartyDb, canon: CanonService): number {
  let promoted = 0;
  for (const record of canon.all()) {
    const momentId = momentIdFromMarker(record.promotedFrom);
    if (momentId !== null && db.markMomentPromoted(momentId, record.ref)) promoted += 1;
  }
  return promoted;
}
