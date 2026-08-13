import {
  SONG_FAMILIES,
  type SongFamily,
} from "./songCatalog.ts";

const firstFamilyByVenue = new Map<number, SongFamily>();

for (const family of [...SONG_FAMILIES].sort(
  (left, right) => left.courseRank - right.courseRank,
)) {
  if (!firstFamilyByVenue.has(family.careerTier)) {
    firstFamilyByVenue.set(family.careerTier, family);
  }
}

/** One playable song from the beginning of each venue, across all difficulties. */
export const DEMO_SONG_FAMILIES: readonly SongFamily[] = [
  ...firstFamilyByVenue.values(),
];

export const DEMO_SONG_FAMILY_IDS = new Set(
  DEMO_SONG_FAMILIES.map((family) => family.id),
);

export function isDemoSongFamily(family: Pick<SongFamily, "id">): boolean {
  return DEMO_SONG_FAMILY_IDS.has(family.id);
}
