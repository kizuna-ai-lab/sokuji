package ai.kizunaai.sokuji.routepicker

import android.content.Intent
import android.media.MediaRouter2
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The system's own output switcher (the "Media output" panel): Android 14 opens
// it for any app through MediaRouter2; Android 11 to 13 through SystemUI's
// broadcast; older ones have no such panel, so the Bluetooth settings stand in.
// Returns which of the three was opened.
class RoutePickerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RoutePicker")

    Function("showOutputSwitcher") {
      val context = appContext.reactContext ?: return@Function "none"
      if (Build.VERSION.SDK_INT >= 34) {
        if (MediaRouter2.getInstance(context).showSystemOutputSwitcher()) return@Function "system"
      }
      if (Build.VERSION.SDK_INT >= 30) {
        val intent = Intent("com.android.systemui.action.LAUNCH_MEDIA_OUTPUT_DIALOG")
          .setPackage("com.android.systemui")
          .putExtra("package_name", context.packageName)
        try {
          context.sendBroadcast(intent)
          return@Function "system"
        } catch (_: Exception) {
        }
      }
      val settings = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return@Function try {
        context.startActivity(settings)
        "bluetooth-settings"
      } catch (_: Exception) {
        "none"
      }
    }
  }
}
