/**
 * Flat ESLint config for both workspaces.
 *
 * Deliberately light: correctness rules only, no stylistic bikeshedding.
 * Out-of-scope modules are policed separately by `npm run verify:scope`, which
 * inspects the Prisma schema rather than the JavaScript.
 */

import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'server/prisma/migrations/**',
      'client/dist/**',
    ],
  },

  js.configs.recommended,

  // --- Server (Node, ESM) ---------------------------------------------------
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        // Node 20+ globals. FormData and File are used by the upload tests,
        // which build the same multipart body the browser does.
        FormData: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        globalThis: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // --- Client (browser, React/JSX) -----------------------------------------
  {
    files: ['client/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        // CSS.escape(), for building a safe attribute selector.
        CSS: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        // Uploading the buyer's measurement sheet: the browser builds the
        // multipart body, so the browser's FormData is the one that is used.
        FormData: 'readonly',
        // A failed FILE request answers with a JSON error body, which arrives
        // as a Blob because the request asked for one. The API layer unwraps it
        // so the user reads the real sentence rather than "Something went
        // wrong"; see services/api.js.
        Blob: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // Build id injected by vite.config.js; see UpdateBanner.jsx.
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      // Without these two the base no-unused-vars cannot see that a component
      // referenced only inside JSX is in fact used.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react/jsx-key': 'error',
      'react/no-danger': 'error',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
];
