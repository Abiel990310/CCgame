/**
 * Where generation 4 puts things. Kept free of imports so the world tables and
 * the generators can both read it without waiting on each other.
 *
 * The map is a square of `FAR_TILES`. Generation 3's mainland sits in its
 * north-west corner exactly as it was grown before, `HOME_TILES` across and
 * with the same tile coordinates, so a seed's home island does not move. The
 * sea fills the rest, and every further island is a row below.
 */
export const HOME_TILES = 256;
export const FAR_TILES = 384;

export interface IslandSite {
  id: string;
  name: string;
  /** Centre, in tiles. */
  cx: number;
  cy: number;
  /** Where the coast would be before the noise wanders it, in tiles. */
  radius: number;
}

/**
 * How far past `radius` an island's land can lie, as a multiple of it: the
 * coast noise wanders the radius by a fifth and the falloff ends just beyond.
 */
export const COAST_REACH = 1.3;

/**
 * The second island. Its coast can come no nearer the mainland than about 17
 * tiles — farther than a grappling hook throws, so the water between is
 * crossed by building over it and not by leaping it.
 */
export const FAR_SHORE: IslandSite = {
  id: 'farShore',
  name: 'The Far Shore',
  cx: 318,
  cy: 128,
  radius: 46,
};
