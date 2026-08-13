/**
 * Metro configuration.
 *
 * The one non-default thing here is `watchFolders`. The canonical translation
 * resources and the wire types live in `../shared` (ADR-018 — one source, no
 * per-surface fork), which sits *above* this package root. Metro refuses to
 * serve files outside the project root unless they are watched explicitly, and
 * because `shared/` is not a package, its transitive `node_modules` lookups
 * have to be pointed back at this app's own installs.
 *
 * docs/mobile/i18n.md: "metro watchFolders `../shared`; resolver documented in
 * mobile README at scaffold".
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '..', 'shared');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];

/**
 * `shared/` has no `node_modules` of its own, so anything it imports has to
 * resolve out of this package.
 *
 * Note what is deliberately NOT set here: `disableHierarchicalLookup`. The
 * usual monorepo recipe turns it on to stop a second copy of React being
 * picked up from a parent directory — but the repo root carries only lint and
 * formatting tooling, no React and no React Native, so there is nothing to
 * shadow. Turning it on actively breaks the build: Expo's own transitive
 * dependencies (`expo-asset`, `expo-font`, …) are installed nested under
 * `node_modules/expo/node_modules`, and a flat-only resolver cannot see them.
 */
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

/**
 * `@shared/*` is spelled the same way here as in tsconfig.json and in the web
 * app's vite config, so an import line can be moved between surfaces unchanged.
 * Declared explicitly rather than relying on Metro's tsconfig-paths support:
 * this is one line, and it cannot silently stop working when that experiment
 * changes shape.
 */
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@shared': sharedRoot,
  '@': path.resolve(projectRoot, 'src'),
};

module.exports = config;
