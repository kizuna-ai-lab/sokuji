const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'cheap-module-source-map',
  entry: {
    background: './background/background.js',
    content: './content/content.js',
    'virtual-microphone': './content/virtual-microphone.js',
    fullpage: './fullpage/index.jsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
          },
        },
      },
      {
        test: /\.scss$/,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    alias: {
      // 创建别名，使得可以直接引用原项目的组件和模块
      '@src': path.resolve(__dirname, '../src'),
      '@components': path.resolve(__dirname, '../src/components'),
      '@contexts': path.resolve(__dirname, '../src/contexts'),
      '@lib': path.resolve(__dirname, '../src/lib'),
      '@utils': path.resolve(__dirname, '../src/utils'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, './fullpage/index.html'),
      filename: 'fullpage.html',
      chunks: ['fullpage'],
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'icons', to: 'icons', noErrorOnMissing: true },
        { 
          from: '../src/lib/wavtools/lib/worklets/*_worklet.js', 
          to: 'worklets/[name][ext]', 
          noErrorOnMissing: true 
        },
        ...(process.env.NODE_ENV === 'development' ? [{ 
          from: '../public/assets/test-tone.mp3', 
          to: 'assets/test-tone.mp3' 
        }] : []),
        { from: 'permission.html', to: 'permission.html' },
        { from: 'requestPermission.js', to: 'requestPermission.js' }
      ],
    }),
  ],
};
