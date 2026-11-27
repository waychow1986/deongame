import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // .ai-delivery/** holds delivery documents and the platform's independent test scripts, not product code.
    ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', '.ai-delivery/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
