/**
 * Conditional class joining.
 *
 * Deliberately not `clsx`/`classnames`: this is the whole of what those
 * packages do that we use, and docs/security/dependency-security.md asks that
 * a dependency earn its place.
 */
export type ClassValue = string | false | null | undefined;

export const cn = (...values: ClassValue[]): string => values.filter(Boolean).join(' ');
