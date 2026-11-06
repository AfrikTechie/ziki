import type { Prisma, PrismaClient } from "@prisma/client";
import { award } from "@/lib/points/award";

type Db = PrismaClient | Prisma.TransactionClient;

/** What every new account gets, in $ (#z-currency). */
export const SIGNUP_BONUS_POINTS = 0.67;

/**
 * The signup bonus (#signup-bonus). Points live in an organisation, so it is
 * paid in the first one the person joins or creates, and only once per
 * account: its source key is the account, so later organisations add nothing.
 */
export async function awardSignupBonus(db: Db, userId: string, organisationId: string): Promise<boolean> {
  return award(db, {
    organisationId,
    userId,
    bugId: null,
    role: "signup",
    points: SIGNUP_BONUS_POINTS,
    sourceKey: `signup:${userId}`,
  });
}
