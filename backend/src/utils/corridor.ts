import { Zone } from '../generated/prisma/enums';

/**
 * CORRIDOR MATCHING RULES (Dhaka Tesla Pool):
 *
 * Two ride requests can be pooled together ONLY if:
 * 1. They share the SAME pickupZone
 * 2. Their destinationZones are in the SAME corridor set
 *
 * Corridor definitions:
 * - BANANI corridor:    [BANANI, MOHAKHALI, GULSHAN_1, GULSHAN_2]
 * - GULSHAN_1 corridor: [GULSHAN_1, BANANI, GULSHAN_2, MOHAKHALI]
 * - MOHAKHALI corridor: [MOHAKHALI, BANANI, FARMGATE]
 * - All other zones:    corridor = [zone itself] (no pooling possible)
 *
 * A destination zone's corridor is looked up; if two destinations share any
 * corridor, they are poolable.
 */
const CORRIDOR_MAP: Record<Zone, Zone[]> = {
    [Zone.BANANI]:      [Zone.BANANI, Zone.MOHAKHALI, Zone.GULSHAN_1, Zone.GULSHAN_2],
    [Zone.GULSHAN_1]:   [Zone.GULSHAN_1, Zone.BANANI, Zone.GULSHAN_2, Zone.MOHAKHALI],
    [Zone.MOHAKHALI]:   [Zone.MOHAKHALI, Zone.BANANI, Zone.FARMGATE],
    [Zone.GULSHAN_2]:   [Zone.GULSHAN_2],
    [Zone.DHANMONDI]:   [Zone.DHANMONDI],
    [Zone.MIRPUR]:      [Zone.MIRPUR],
    [Zone.UTTARA]:      [Zone.UTTARA],
    [Zone.FARMGATE]:    [Zone.FARMGATE],
    [Zone.BASHUNDHARA]: [Zone.BASHUNDHARA],
};

/**
 * Returns the corridor set for a given destination zone.
 */
export function getCorridorFor(zone: Zone): Zone[] {
    return CORRIDOR_MAP[zone];
}

/**
 * Checks if two destination zones are in the same corridor.
 * A zone's corridor is the set it belongs to in CORRIDOR_MAP.
 * Two zones are "corridor-compatible" if zone2 appears in zone1's corridor
 * OR zone1 appears in zone2's corridor (symmetric check).
 */
export function areInSameCorridor(dest1: Zone, dest2: Zone): boolean {
    const corridor1 = CORRIDOR_MAP[dest1];
    const corridor2 = CORRIDOR_MAP[dest2];
    return (corridor1?.includes(dest2) || corridor2?.includes(dest1)) ?? false;
}
