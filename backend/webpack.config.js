module.exports = function (options, webpack) {
  return {
    ...options,
    externals: {
      sharp: 'commonjs sharp',
      iyzipay: 'commonjs iyzipay',
      '@sentry/profiling-node': 'commonjs @sentry/profiling-node',
      ssh2: 'commonjs ssh2',
      'cpu-features': 'commonjs cpu-features',
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
