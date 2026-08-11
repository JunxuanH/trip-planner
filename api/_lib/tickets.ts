/**
 * The ticket vault: booking PDFs, kept out of git and out of the built page.
 *
 * Why not simply inline them like everything else? Because `dist/` is committed
 * and published from a public repo, and these documents carry order numbers, a
 * GetYourGuide PIN and a Vatican voucher code — enough to cancel the trip. The
 * plan's whole design is "one file, nothing fetched"; this is the one thing that
 * cannot follow that rule, so it is the one thing that lives behind auth.
 *
 * Blobs are stored with random suffixes and their URLs are never handed to the
 * browser. `api/tickets.ts` streams the bytes instead. That is not paranoia
 * about the URLs being guessable — it keeps plan.html talking to exactly the two
 * hosts its build gate allows, so the exception cannot widen by accident.
 */
import { list } from '@vercel/blob';

const PREFIX = 'italy2026/tickets/';

export type Ticket = {
  id: string;
  label: string;
  /** Which day of the trip it belongs to, for ordering in the drawer. */
  day: number;
  filename: string;
  size: number;
  url: string;
};

/**
 * Labels live here rather than in the blob metadata so they can be reworded
 * without re-uploading a megabyte. Keyed by the id embedded in the pathname.
 */
const LABELS: Record<string, { label: string; day: number }> = {
  'vatican-voucher': { label: 'Vatican Gardens & Museums — Aug 25, 8:30am', day: 2 },
  'borghese-reservation': { label: 'Galleria Borghese — Aug 26, 1:00pm', day: 3 },
  'duomo-pass-junxuan': { label: 'Brunelleschi Pass — Junxuan, dome 4:30pm Aug 27', day: 4 },
  'duomo-pass-hanji': { label: 'Brunelleschi Pass — Hanji, dome 4:30pm Aug 27', day: 4 },
  'accademia-junxuan': { label: 'Accademia — Junxuan, entry 2:30pm Aug 27', day: 4 },
  'accademia-hanji': { label: 'Accademia — Hanji, entry 2:30pm Aug 27', day: 4 },
};

function idOf(pathname: string): string {
  // italy2026/tickets/vatican-voucher-Xy9.pdf → vatican-voucher
  const base = pathname.slice(PREFIX.length).replace(/\.pdf$/i, '');
  const known = Object.keys(LABELS).find((k) => base.startsWith(k));
  return known ?? base;
}

export async function listTickets(): Promise<Ticket[]> {
  const { blobs } = await list({ prefix: PREFIX });
  return blobs
    .map((b) => {
      const id = idOf(b.pathname);
      const meta = LABELS[id];
      return {
        id,
        label: meta?.label ?? id,
        day: meta?.day ?? 99,
        filename: b.pathname.slice(PREFIX.length),
        size: b.size,
        url: b.url,
      };
    })
    .sort((a, b) => a.day - b.day || a.label.localeCompare(b.label));
}

export async function findTicket(id: string): Promise<Ticket | undefined> {
  return (await listTickets()).find((t) => t.id === id);
}
