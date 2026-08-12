/**
 * Registration and login.
 *
 * The theme throughout is that failure must be indistinguishable. An attacker
 * probing this service should learn nothing about which email addresses have
 * accounts — not from the status code, not from the message key, and not from
 * how long the response took.
 */
import bcrypt from 'bcrypt';

import { BCRYPT_COST } from '../config/constants.js';
import { User } from '../models/index.js';
import { AppError, authenticationError } from '../utils/errors.js';

/**
 * A real bcrypt hash of a value nobody can supply, compared against when the
 * email is unknown. Without it, "no such user" returns in microseconds while
 * "wrong password" takes ~250ms, and that difference alone enumerates accounts.
 * Generated once at module load, never used as a credential.
 */
const TIMING_DECOY_HASH = bcrypt.hashSync(
  `timing-decoy-${Math.random()}-${Date.now()}`,
  BCRYPT_COST,
);

export async function register({ name, email, password, language }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const user = await User.create({ name, email, passwordHash, language });
    return user;
  } catch (err) {
    // The unique index is what actually decides the race — two simultaneous
    // registrations for one address cannot both win. A pre-check `findOne`
    // would be both racy and a faster enumeration oracle.
    if (err?.code === 11000) {
      throw new AppError('CONFLICT', 'auth.registerFailed');
    }
    throw err;
  }
}

/**
 * @returns {Promise<import('mongoose').Document>} the authenticated user
 * @throws {AppError} always the same 401 for every failure mode
 */
export async function login({ email, password }) {
  // passwordHash is `select: false`, so it must be asked for explicitly.
  const user = await User.findOne({ email }).select('+passwordHash');

  // Compare unconditionally: branching on whether the user exists is the
  // timing leak this decoy is here to close.
  const hash = user?.passwordHash ?? TIMING_DECOY_HASH;
  const matches = await bcrypt.compare(password, hash);

  if (!user || !matches) throw authenticationError();

  user.lastLoginAt = new Date();
  await user.save();

  return user;
}
