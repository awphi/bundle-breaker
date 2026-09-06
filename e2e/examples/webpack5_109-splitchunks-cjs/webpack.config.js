const path = require("path");

module.exports = {
  context: path.resolve(__dirname),
  mode: "production",
  entry: {
    index: path.resolve(__dirname, "index.js"),
  },
  output: {
    path: path.resolve(__dirname, "out"),
    filename: "[name].[contenthash:8].js",
    clean: true,
    chunkFormat: "commonjs",
  },
  optimization: {
    minimize: false,
    splitChunks: {
      chunks: "all",
      minSize: 0,
    },
  },
  module: {
    rules: [
      {
        test: /\.(js)$/,
        use: ["babel-loader"],
        exclude: /node_modules/,
      },
    ],
  },
};
