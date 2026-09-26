import { RideStatus } from '../generated/prisma/enums';

/**
 * ============================================================================
 * RIDE LIFECYCLE STATE MACHINE (Dhaka Tesla Pool):
 * ============================================================================
 *
 * VALID TRANSITIONS ONLY:
 *   REQUESTED -> MATCHED          (driver accepts solo or pooled ride)
 *   MATCHED -> DRIVER_ARRIVED     (driver arrives at pickup)
 *   DRIVER_ARRIVED -> STARTED     (driver starts trip)
 *   STARTED -> COMPLETED          (driver marks trip completed)
 *   CANCELLED can only be reached from REQUESTED, MATCHED, or DRIVER_ARRIVED
 *     (never from STARTED or COMPLETED)
 *
 * Any other transition attempt must be rejected with 409 Conflict:
 *   "Cannot transition from <currentStatus> to <attemptedStatus>"
 * ============================================================================
 */

export const VALID_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
    [RideStatus.REQUESTED]: [RideStatus.MATCHED, RideStatus.CANCELLED],
    [RideStatus.MATCHED]: [RideStatus.DRIVER_ARRIVED, RideStatus.CANCELLED],
    [RideStatus.DRIVER_ARRIVED]: [RideStatus.STARTED, RideStatus.CANCELLED],
    [RideStatus.STARTED]: [RideStatus.COMPLETED],
    [RideStatus.COMPLETED]: [],
    [RideStatus.CANCELLED]: [],
};

export class TransitionError extends Error {
    readonly fromStatus: RideStatus;
    readonly toStatus: RideStatus;

    constructor(fromStatus: RideStatus | string, toStatus: RideStatus | string) {
        super(`Cannot transition from ${fromStatus} to ${toStatus}`);
        this.name = 'TransitionError';
        this.fromStatus = fromStatus as RideStatus;
        this.toStatus = toStatus as RideStatus;
    }
}

/**
 * Pure function checking if a state transition from `from` to `to` is allowed.
 *
 * @param from Current RideStatus
 * @param to Target RideStatus
 * @returns boolean
 */
export function isValidTransition(from: RideStatus | string, to: RideStatus | string): boolean {
    const allowed = VALID_TRANSITIONS[from as RideStatus];
    return allowed ? allowed.includes(to as RideStatus) : false;
}

/**
 * Validates transition or throws a TransitionError.
 *
 * @param from Current RideStatus
 * @param to Target RideStatus
 */
export function assertValidTransition(from: RideStatus | string, to: RideStatus | string): void {
    if (!isValidTransition(from, to)) {
        throw new TransitionError(from, to);
    }
}
