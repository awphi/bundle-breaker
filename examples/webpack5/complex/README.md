# webpack5/complex

This is a simple dummy app that acts as a useful benchmark for the real-world performance of `bundle-breaker`. This web app aims to mimic common aspects of webpack-bundled production web applications like:

- HTML plugin (`html-webpack-plugin`)
- Built on a framework (`react`)
- Uses external libraries to render DOM components (`highcharts`)
- Minified (`terser`)
- Transpiled with polyfills (`babel`, `@babel/preset-env`, `@babel/preset-react`)
- Imports from a large icon library (`react-icons`)
- CSS-in-JSS (`styled-components`)

This app is not intended to exhaustively cover the infinite flavours and varieties of JS applications available today but aims to capture a handful of common patterns that are likely to cause issues when debundling.
