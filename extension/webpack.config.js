const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
  const isDevMode = argv.mode === 'development';
  
  return {
    mode: argv.mode || 'development',
    devtool: isDevMode ? 'cheap-module-source-map' : false,
    entry: {
      background: './background/background.js',
      content: './content/content.js',
      'zoom-content': './content/zoom-content.js',
      'content/site-plugins': './content/site-plugins.js',
      'content/virtual-microphone': './content/virtual-microphone.js',
      'content/device-emulator.iife': './content/device-emulator.iife.js',
      fullpage: '../shared/index.tsx',
      popup: './popup.js',
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
        '@src': path.resolve(__dirname, '../src'),
        '@components': path.resolve(__dirname, '../src/components'),
        '@contexts': path.resolve(__dirname, '../src/contexts'),
        '@lib': path.resolve(__dirname, '../src/lib'),
        '@utils': path.resolve(__dirname, '../src/utils'),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(argv.mode || 'development'),
        // Define import.meta for Extension builds to prevent runtime errors
        'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_dG9waWNhbC1pbXBhbGEtNjAuY2xlcmsuYWNjb3VudHMuZGV2JA'),
        'import.meta.env.VITE_BACKEND_URL': JSON.stringify('https://sokuji-api-dev.kizuna.ai'),
        'import.meta.env.DEV': JSON.stringify(isDevMode),
        // Define import.meta.url as empty string to prevent parse errors
        'import.meta.url': JSON.stringify('')
      }),
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, '../shared/index.html'),
        filename: 'fullpage.html',
        chunks: ['fullpage'],
      }),
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, './popup.html'),
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: '_locales', to: '_locales', noErrorOnMissing: true },
          { from: 'icons', to: 'icons', noErrorOnMissing: true },
          { 
            from: '../src/lib/wavtools/lib/worklets/*_worklet.js', 
            to: 'worklets/[name][ext]', 
            noErrorOnMissing: true 
          },
          {
            from: '../src/services/worklets/palabra-audio-worklet-processor.js',
            to: 'worklets/palabra-audio-worklet-processor.js',
            noErrorOnMissing: true
          },
          {
            from: '../src/services/worklets/audio-recorder-worklet-processor.js',
            to: 'worklets/audio-recorder-worklet-processor.js',
          },
          ...(isDevMode ? [{ 
            from: '../public/assets/test-tone.mp3', 
            to: 'assets/test-tone.mp3' 
          }] : []),
          { from: 'permission.html', to: 'permission.html' },
          { from: 'requestPermission.js', to: 'requestPermission.js' },
          { from: 'popup.css', to: 'popup.css' }
        ],
      }),
    ],
  };
};
