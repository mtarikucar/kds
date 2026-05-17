const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = function (options, webpack) {
  return {
    ...options,
    externals: {
      sharp: 'commonjs sharp',
      iyzipay: 'commonjs iyzipay',
      '@sentry/profiling-node': 'commonjs @sentry/profiling-node',
    },
    module: {
      ...options.module,
      rules: [
        ...options.module.rules,
        {
          test: /\.node$/,
          use: 'node-loader',
        },
      ],
    },
    plugins: [
      ...(options.plugins ?? []),
      // Handlebars email templates live next to the modules that send
      // them. NotificationService resolves them at runtime via
      // `path.join(__dirname, '../templates/emails')`; after webpack
      // bundles everything into dist/main.js, __dirname is dist/, so the
      // resolved path becomes backend/templates/emails. Copy all .hbs
      // files there at build time so production runtime sees the same
      // template set the dev (ts-node) runtime sees.
      new CopyPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'src/modules/subscriptions/templates/emails'),
            to: path.resolve(__dirname, 'templates/emails'),
            globOptions: { ignore: ['**/*.ts'] },
          },
        ],
      }),
    ],
  };
};
