// NativeWind compiles `className` into styles: its JSX runtime and Babel
// preset. `babel-preset-expo` is a direct devDependency because an SDK 58 app
// does not hoist it, and naming it here would fail to resolve otherwise.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
