package ai.kizunaai.sokuji.routepicker

import android.content.ActivityNotFoundException
import android.content.Intent
import android.media.MediaRouter2
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The system's own output switcher (the "Media output" panel), by the way each
// Android version offers it (each checked on an emulator image):
//  - 14 and later: MediaRouter2.showSystemOutputSwitcher();
//  - 12 and 13: SystemUI's dialog, opened by a broadcast to its receiver,
//    sent only when the receiver exists (a broadcast with no receiver fails
//    silently; Settings' panel action is gone on 13);
//  - 11: the Settings panel, by its action;
//  - otherwise, or when none of these answers: the Bluetooth settings.
// Returns which was opened.
class RoutePickerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RoutePicker")

    Function("showOutputSwitcher") {
      val context = appContext.reactContext ?: return@Function "none"
      // From the app's own activity, a panel opens over it (back returns to the
      // app); only without one does it need a new task.
      val activity = appContext.currentActivity
      fun start(intent: Intent) {
        if (activity != null) activity.startActivity(intent)
        else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      if (Build.VERSION.SDK_INT >= 34 && MediaRouter2.getInstance(context).showSystemOutputSwitcher()) {
        return@Function "system"
      }
      if (Build.VERSION.SDK_INT >= 31) {
        val dialog = Intent("com.android.systemui.action.LAUNCH_MEDIA_OUTPUT_DIALOG")
          .setPackage("com.android.systemui")
          .putExtra("package_name", context.packageName)
        @Suppress("DEPRECATION")
        if (context.packageManager.queryBroadcastReceivers(dialog, 0).isNotEmpty()) {
          context.sendBroadcast(dialog)
          return@Function "system"
        }
      }
      if (Build.VERSION.SDK_INT >= 30) {
        val panel = Intent("com.android.settings.panel.action.MEDIA_OUTPUT")
          .putExtra("com.android.settings.panel.extra.PACKAGE_NAME", context.packageName)
        try {
          start(panel)
          return@Function "system"
        } catch (_: ActivityNotFoundException) {
        } catch (_: SecurityException) {
        }
      }
      val settings = Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
      return@Function try {
        start(settings)
        "bluetooth-settings"
      } catch (_: ActivityNotFoundException) {
        "none"
      } catch (_: SecurityException) {
        "none"
      }
    }
  }
}
