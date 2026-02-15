const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

// Load root .env file so production builds pick up feature flags
// without needing `export` or manual env var forwarding
const rootEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    // Don't override explicitly set env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

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
        // PostHog analytics configuration - set via environment or leave empty to disable
        'process.env.POSTHOG_KEY': JSON.stringify(process.env.POSTHOG_KEY || ''),
        'process.env.POSTHOG_HOST': JSON.stringify(process.env.POSTHOG_HOST || 'https://us.i.posthog.com'),
        // Define import.meta for Extension builds to prevent runtime errors
        'import.meta.env.MODE': JSON.stringify(argv.mode || 'development'),
        'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
          process.env.VITE_BACKEND_URL || ''
        ),
        'import.meta.env.VITE_ENABLE_KIZUNA_AI': JSON.stringify(
          isDevMode
            ? 'true'  // Always enable in development
            : process.env.VITE_ENABLE_KIZUNA_AI || 'false'  // Disabled by default in production unless explicitly enabled
        ),
        'import.meta.env.VITE_ENABLE_PALABRA_AI': JSON.stringify(
          process.env.VITE_ENABLE_PALABRA_AI || 'false'  // Disabled by default, can be enabled via env var
        ),
        'import.meta.env.VITE_ENABLE_VOLCENGINE_ST': JSON.stringify(
          isDevMode
            ? 'true'
            : process.env.VITE_ENABLE_VOLCENGINE_ST || 'false'
        ),
        'import.meta.env.VITE_ENABLE_VOLCENGINE_AST2': JSON.stringify(
          isDevMode
            ? 'true'
            : process.env.VITE_ENABLE_VOLCENGINE_AST2 || 'false'
        ),
        // PostHog analytics configuration for shared/index.tsx (fullpage entry)
        'import.meta.env.VITE_POSTHOG_KEY': JSON.stringify(process.env.POSTHOG_KEY || ''),
        'import.meta.env.VITE_POSTHOG_HOST': JSON.stringify(process.env.POSTHOG_HOST || 'https://us.i.posthog.com'),
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
            from: '../src/services/worklets/pcm-audio-worklet-processor.js',
            to: 'worklets/pcm-audio-worklet-processor.js',
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
