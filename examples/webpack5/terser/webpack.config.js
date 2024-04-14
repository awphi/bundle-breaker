const path = require("path");
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
    clean: true,
  },
  plugins: [new TerserPlugin()],
  optimization: {
    minimize: true,
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
