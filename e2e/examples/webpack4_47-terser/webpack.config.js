const path = require("path");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  context: path.resolve(__dirname),
  mode: "production",
  entry: {
    index: path.resolve(__dirname, "index.js"),
  },
  output: {
    path: path.resolve(__dirname, "out"),
    filename: "[name].[contenthash:8].js",
  },
  optimization: {
    minimize: true,
  },
  plugins: [new CleanWebpackPlugin(), new TerserPlugin()],
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
