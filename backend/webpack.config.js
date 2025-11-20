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
  };
};
