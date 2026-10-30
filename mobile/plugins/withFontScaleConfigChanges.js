// The Android activity handles font-size and display-size changes itself.
// Without fontScale and density in its configChanges, changing either in the
// system settings recreates the activity: React Native reloads, a running
// session's socket closes and its foreground service goes, and the subtitles
// are lost (Sophie, Pixel 9a / Android 16, 2026-10-28). React Native already
// re-reads the font scale on a configuration change (useWindowDimensions).
// android/ is generated, so the change lives here, applied at prebuild.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const HANDLED = ['fontScale', 'density'];

/** The configChanges value with fontScale and density added (once each), the rest kept in order. */
function addConfigChanges(value) {
  const parts = (value || '').split('|').filter(Boolean);
  for (const change of HANDLED) if (!parts.includes(change)) parts.push(change);
  return parts.join('|');
}

function withFontScaleConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity.$['android:configChanges'] = addConfigChanges(activity.$['android:configChanges']);
    return cfg;
  });
}

module.exports = withFontScaleConfigChanges;
module.exports.addConfigChanges = addConfigChanges;
