module.exports = function (options, webpack) {
  return {
    ...options,
    externals: {
      sharp: 'commonjs sharp',
      iyzipay: 'commonjs iyzipay',
    },
  };
};
