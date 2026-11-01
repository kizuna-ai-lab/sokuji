package ai.kizunaai.sokuji.routepicker

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRoute2Info
import android.media.MediaRouter
import android.media.MediaRouter2
import android.media.RouteDiscoveryPreference
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.annotation.RequiresApi
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
//
// The output in use and its changes, which the audio library leaves empty on
// Android: currentOutput() reads the device media plays on, and routeChange
// fires when a device comes or goes (AudioDeviceCallback) or the selection
// among connected ones moves (the router: nothing is added or removed then).
class RoutePickerModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var observers: (() -> Unit)? = null

  private fun audioManager(context: Context) = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun categoryOf(device: AudioDeviceInfo) = when (device.type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_HEARING_AID,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER -> "Bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired"
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Built-in Speaker"
    else -> "Other"
  }

  private fun currentDevice(context: Context): AudioDeviceInfo? {
    val audio = audioManager(context)
    if (Build.VERSION.SDK_INT >= 33) {
      val media = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
      audio.getAudioDevicesForAttributes(media).firstOrNull()?.let { return it }
    }
    // Before 13 no call names the device: the router tells Bluetooth from the
    // rest, and a plugged-in device takes the sound from the speaker by itself.
    val outputs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val router = context.getSystemService(Context.MEDIA_ROUTER_SERVICE) as MediaRouter
    val selected = router.getSelectedRoute(MediaRouter.ROUTE_TYPE_LIVE_AUDIO)
    if (selected.deviceType == MediaRouter.RouteInfo.DEVICE_TYPE_BLUETOOTH) {
      outputs.firstOrNull { categoryOf(it) == "Bluetooth" }?.let { return it }
    }
    return outputs.firstOrNull { categoryOf(it) == "Wired" || categoryOf(it) == "USB" }
      ?: outputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
  }

  private fun startObserving(context: Context) {
    // One switch reports several times; one event is enough.
    val emit = Runnable { sendEvent("routeChange") }
    val changed = {
      mainHandler.removeCallbacks(emit)
      mainHandler.postDelayed(emit, 100)
      Unit
    }
    val audio = audioManager(context)
    val devices = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = changed()
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = changed()
    }
    audio.registerAudioDeviceCallback(devices, mainHandler)
    val stopRouter = if (Build.VERSION.SDK_INT >= 30) observeRouter2(context, changed) else observeRouter(context, changed)
    observers = {
      audio.unregisterAudioDeviceCallback(devices)
      stopRouter()
      mainHandler.removeCallbacks(emit)
    }
  }

  // The route callback is what registers the app with the system; without it
  // the controller never updates. (On the Pixel, Android 17, a switch in the
  // panel reached these and never the older MediaRouter.)
  @RequiresApi(30)
  private fun observeRouter2(context: Context, changed: () -> Unit): () -> Unit {
    val router = MediaRouter2.getInstance(context)
    val executor = context.mainExecutor
    val routes = object : MediaRouter2.RouteCallback() {
      override fun onRoutesUpdated(routes: MutableList<MediaRoute2Info>) = changed()
    }
    val controller = object : MediaRouter2.ControllerCallback() {
      override fun onControllerUpdated(controller: MediaRouter2.RoutingController) = changed()
    }
    val discovery = RouteDiscoveryPreference.Builder(listOf(MediaRoute2Info.FEATURE_LIVE_AUDIO), false).build()
    router.registerRouteCallback(executor, routes, discovery)
    router.registerControllerCallback(executor, controller)
    return {
      router.unregisterRouteCallback(routes)
      router.unregisterControllerCallback(controller)
    }
  }

  // Android 10, which has no MediaRouter2.
  private fun observeRouter(context: Context, changed: () -> Unit): () -> Unit {
    val router = context.getSystemService(Context.MEDIA_ROUTER_SERVICE) as MediaRouter
    val routes = object : MediaRouter.SimpleCallback() {
      override fun onRouteSelected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) = changed()
      override fun onRouteUnselected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) = changed()
      override fun onRouteChanged(router: MediaRouter, info: MediaRouter.RouteInfo) = changed()
    }
    mainHandler.post { router.addCallback(MediaRouter.ROUTE_TYPE_LIVE_AUDIO, routes) }
    return { mainHandler.post { router.removeCallback(routes) } }
  }

  override fun definition() = ModuleDefinition {
    Name("RoutePicker")

    Events("routeChange")

    OnStartObserving { appContext.reactContext?.let { startObserving(it) } }

    OnStopObserving {
      observers?.invoke()
      observers = null
    }

    // A reload destroys the module without stopping observation first.
    OnDestroy {
      observers?.invoke()
      observers = null
    }

    Function("currentOutput") {
      val context = appContext.reactContext ?: return@Function null
      val device = currentDevice(context) ?: return@Function null
      mapOf("id" to device.id.toString(), "name" to device.productName.toString(), "category" to categoryOf(device))
    }

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
