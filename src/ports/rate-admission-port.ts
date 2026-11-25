/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { VerifiedAuthContext } from "./auth-port.js";

declare const reservationBrand: unique symbol;
export type Reservation = { readonly [reservationBrand]: true };
export type Decision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "quota"
        | "capacity"
        | "reservation_invalid"
        | "closed"
        | "store_error";
      retryAfterMs?: number;
    };
export type Reserved =
  | { allowed: true; reservation: Reservation }
  | Exclude<Decision, { allowed: true }>;

export interface RateAdmissionPort {
  consumeLogin(input: { trustedIp: string }): Decision;
  reserveApi(input: { trustedIp: string }): Reserved;
  completeVerified(input: {
    reservation: Reservation;
    credential: Pick<VerifiedAuthContext, "authMethod" | "credentialId">;
  }): Decision;
  completeUnverified(input: { reservation: Reservation }): { settled: boolean };
  expire(): void;
  close(): void;
}
