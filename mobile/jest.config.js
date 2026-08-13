/**
 * Unit tests only — the scope docs/mobile/testing.md commits to: "hooks +
 * services (jest-expo): useAnalyze state machine, voice intent matcher,
 * offline persist config, api interceptors (mocked axios)". There is no Detox
 * suite; device coverage is the scripted manual matrix in the same document.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    /**
     * `shared/` sits outside this package and has no `node_modules` of its own,
     * so the `@babel/runtime` helpers Babel injects into a transpiled shared
     * module resolve from `shared/` and find nothing. Pointing them at this
     * package's copy is the alternative to giving the repo root a dependency
     * tree it does not otherwise need (ADR-019: apps keep their own).
     */
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
  /**
   * The Expo/RN packages ship untranspiled ESM, so the default
   * "ignore everything in node_modules" would break on the first import.
   */
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@tanstack/.*|native-base|react-native-svg)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
