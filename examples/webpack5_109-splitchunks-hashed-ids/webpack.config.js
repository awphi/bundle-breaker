const path = require("path");
const webpack = require("webpack");

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
  },
  plugins: [new webpack.ids.HashedModuleIdsPlugin()],
  optimization: {
    minimize: false,
    splitChunks: {
      chunks: "async",
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
