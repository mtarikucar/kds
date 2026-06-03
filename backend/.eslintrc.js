module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_'
    }],
  },
  overrides: [
    {
      // Phase-1 marketing-decoupling boundary. The marketing bounded context
      // must not read/write CORE tables directly — all core access goes through
      // the cross-context ports (CoreProvisioningPort) or domain events.
      // Step F: now ERROR (the seam is complete — convert() and offer-create
      // both go through the port), so CI blocks any regression that would
      // re-couple marketing to core tables.
      files: ['src/modules/marketing/**/*.ts'],
      excludedFiles: ['src/modules/marketing/**/*.spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "MemberExpression[object.property.name='prisma'][property.name=/^(tenant|user|subscription|subscriptionPlan|subscriptionPayment|contactMessage)$/]",
            message:
              'Marketing must not access core tables directly (prisma.<coreDelegate>). Use CoreProvisioningPort or a domain event.',
          },
          {
            selector:
              "MemberExpression[object.name='tx'][property.name=/^(tenant|user|subscription|subscriptionPlan|subscriptionPayment|contactMessage)$/]",
            message:
              'Marketing must not write core tables in a transaction (tx.<coreDelegate>). Use CoreProvisioningPort instead.',
          },
        ],
      },
    },
  ],
};
