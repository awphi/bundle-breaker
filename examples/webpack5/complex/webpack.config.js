const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  context: path.resolve(__dirname),
  mode: "production",
  entry: {
    index: path.resolve(__dirname, "src", "index.js"),
  },
  output: {
    path: path.resolve(__dirname, "out"),
    filename: "[name].[contenthash:8].js",
    clean: true,
  },
  plugins: [
    //new TerserPlugin(),
    new HtmlWebpackPlugin({ favicon: path.resolve(__dirname, "favicon.ico") }),
  ],
  resolve: {
    extensions: [".js", ".jsx"],
  },
  optimization: {
    minimize: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              ["@babel/preset-env", { targets: "> 0.25%, not dead" }],
              "@babel/preset-react",
            ],
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};
