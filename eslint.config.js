import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    // Ignore build output and any top-level "exported" snapshot files.
    // These root files are not part of the Vite/React source tree and may contain
    // concatenated snippets that are not valid ES modules (causing parse errors).
    ignores: [
      'dist',
      'ai.js',
      'BattleScene.js',
      'Fighter.js',
      'createPhaserGame.js',
      'debug.js',
      'input.js',
      'moves.js',
      'page.jsx',
      'stage.js',
      'benchmarkStorage.js',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
]
