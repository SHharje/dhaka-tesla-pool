import { Zone } from '../generated/prisma/enums';
import { areInSameCorridor } from './corridor';

/**
 * ============================================================================
 * FARE MODEL (Dhaka Tesla Pool):
 * ============================================================================
 *
 * passengerFare = baseFare + distanceCharge - poolDiscount
 *
 * baseFare:
 *   - 2000 poysha (flat per ride request, integer poysha)
 *
 * distanceCharge:
 *   - 3000 poysha if pickupZone and destinationZone are in the same "corridor"
 *     (1 hop) - reuses the corridor definitions from the pooling logic
 *   - 5000 poysha otherwise (2 hops)
 *
 * poolDiscount:
 *   - 25% of distanceCharge, ONLY if the ride's pool has seatsOccupied > 1
 *     at calculation time
 *   - 0 if the ride is solo (not pooled, or pool has only 1 occupied seat)
 *
 * All amounts are integer poysha (1 taka = 100 poysha) - never use floating point
 * for money anywhere in this calculation.
 *
 * Rounding Rule:
 *   Intermediate percentage math (25% of distanceCharge) is rounded to the nearest
 *   integer poysha using standard rounding via Math.round((distanceCharge * 25) / 100),
 *   NOT truncation / floor (Math.floor).
 *
 * Worked Examples:
 *   - Nusrat (Banani -> Mohakhali) pooled with Rafiq (Banani -> Gulshan_1):
 *     both are 1-hop (same corridor) = distanceCharge 3000 each
 *     poolDiscount = Math.round((3000 * 25) / 100) = 750
 *     passengerFare = 2000 + 3000 - 750 = 4250 poysha each
 *
 *   - Solo Banani -> Mohakhali ride (not pooled):
 *     distanceCharge = 3000 (1 hop, same corridor), poolDiscount = 0
 *     passengerFare = 2000 + 3000 - 0 = 5000 poysha
 *
 *   - Solo Banani -> Uttara ride (not pooled, different corridor):
 *     distanceCharge = 5000 (2 hops), poolDiscount = 0
 *     passengerFare = 2000 + 5000 - 0 = 7000 poysha
 *
 *   - Pooled Banani -> Uttara ride (pooled, different corridor):
 *     distanceCharge = 5000 (2 hops), poolDiscount = Math.round((5000 * 25) / 100) = 1250
 *     passengerFare = 2000 + 5000 - 1250 = 5750 poysha
 * ============================================================================
 */

export const BASE_FARE_POYSHA = 2000;
export const SAME_CORRIDOR_DISTANCE_CHARGE_POYSHA = 3000;
export const OTHER_CORRIDOR_DISTANCE_CHARGE_POYSHA = 5000;
export const POOL_DISCOUNT_PERCENT = 25;

export interface FareBreakdown {
    baseFarePoysha: number;
    distanceChargePoysha: number;
    poolDiscountPoysha: number;
    totalPoysha: number;
}

export type FareEstimate = FareBreakdown;

/**
 * Calculates the complete itemized fare breakdown in integer poysha.
 *
 * @param pickupZone - The pickup zone
 * @param destinationZone - The destination zone
 * @param isPooled - True if pool has seatsOccupied > 1 at calculation time
 * @returns FareBreakdown with all amounts in integer poysha
 */
export function calculateFareBreakdown(
    pickupZone: Zone | string,
    destinationZone: Zone | string,
    isPooled: boolean = false,
): FareBreakdown {
    const isSameCorridor = areInSameCorridor(pickupZone as Zone, destinationZone as Zone);
    const distanceChargePoysha = isSameCorridor
        ? SAME_CORRIDOR_DISTANCE_CHARGE_POYSHA
        : OTHER_CORRIDOR_DISTANCE_CHARGE_POYSHA;

    // Standard rounding: round half-up/nearest integer poysha, NOT truncation (Math.floor)
    const poolDiscountPoysha = isPooled
        ? Math.round((distanceChargePoysha * POOL_DISCOUNT_PERCENT) / 100)
        : 0;

    const totalPoysha = BASE_FARE_POYSHA + distanceChargePoysha - poolDiscountPoysha;

    return {
        baseFarePoysha: BASE_FARE_POYSHA,
        distanceChargePoysha,
        poolDiscountPoysha,
        totalPoysha,
    };
}

/**
 * Pure, independently unit-testable function that returns the total passenger fare in integer poysha.
 *
 * @param pickupZone - The pickup zone
 * @param destinationZone - The destination zone
 * @param isPooled - True if pool has seatsOccupied > 1 at calculation time
 * @returns Total passenger fare in integer poysha
 */
export function calculateFare(
    pickupZone: Zone | string,
    destinationZone: Zone | string,
    isPooled: boolean = false,
): number {
    return calculateFareBreakdown(pickupZone, destinationZone, isPooled).totalPoysha;
}
