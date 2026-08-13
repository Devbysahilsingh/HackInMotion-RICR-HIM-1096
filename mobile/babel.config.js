/**
 * `babel-preset-expo` covers JSX, TypeScript and the Hermes target. The one
 * addition is the production console strip: docs/mobile/security.md requires
 * that a release build carry no console output, because logs on a shared
 * handset are a disclosure surface and `console.log` survives minification.
 */
module.exports = function babelConfig(api) {
  api.cache(true);

  const plugins = [];

  if (process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production') {
    // `error` is kept: a crash report with nothing in it helps nobody, and it
    // never carries user data by convention (same rule the backend lints for).
    plugins.push(['transform-remove-console', { exclude: ['error'] }]);
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
