// @ts-check

/** @type {import('eslint').Linter.LegacyConfig} */
const config = {
  root: true,
  extends: ['@bigcommerce/catalyst/base', '@bigcommerce/catalyst/prettier'],
  ignorePatterns: ['/dist/**'],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
  },
  overrides: [
    {
      files: ['./src/cli/**'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};

module.exports = config;
