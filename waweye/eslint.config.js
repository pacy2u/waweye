'use strict';
// ESLint (npm run lint): the recommended rules only, no formatting rules (a formatter waits for the owner's decision,
// PLAN_NAPRAWCZY_TESTOW.md B2). Node code is CommonJS, the Worker is an ES module, public/*.js are browser scripts
// (the shared ones also load in Node for the unit tests).
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['public/vendor/**', 'wideo-promocyjne/**', 'wideo-przewodnik/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      // `catch {}` around optional work (a broken store, an unreadable body) is deliberate here.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `const { secret, ...rest } = x` drops a field on purpose.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.serviceworker } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.commonjs, L: 'readonly', wawTrasa: 'readonly', wawPrognoza: 'readonly', toPL2000z7: 'readonly' } },
  },
  {
    // The browser test runs code inside the page (window, document, L) from page.evaluate callbacks.
    files: ['test/e2e.js'],
    languageOptions: { globals: { ...globals.browser, L: 'readonly' } },
  },
];
