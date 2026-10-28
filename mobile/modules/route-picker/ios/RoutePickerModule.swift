import AVKit
import ExpoModulesCore

// The system's own output picker (AirPlay, Bluetooth, the phone's speaker).
// iOS has no API that opens its list from code, so the app lays this view,
// its icon clear, over the row it belongs to and the user's tap reaches it.
public class RoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoutePicker")

    View(RoutePickerView.self) {
      // What a screen reader says for the row the view covers.
      Prop("label") { (view: RoutePickerView, label: String?) in
        view.accessibilityLabel = label
      }
    }
  }
}

class RoutePickerView: ExpoView {
  let picker = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.prioritizesVideoDevices = false
    picker.tintColor = .clear
    picker.activeTintColor = .clear
    addSubview(picker)
    // One element for VoiceOver: this view, read as the row, opening the list
    // when activated; the picker's own button ("AirPlay") is hidden inside it.
    isAccessibilityElement = true
    accessibilityTraits = .button
    picker.accessibilityElementsHidden = true
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }

  override func accessibilityActivate() -> Bool {
    guard let button = Self.firstButton(in: picker) else { return false }
    button.sendActions(for: .touchUpInside)
    return true
  }

  private static func firstButton(in view: UIView) -> UIButton? {
    for sub in view.subviews {
      if let button = sub as? UIButton { return button }
      if let found = firstButton(in: sub) { return found }
    }
    return nil
  }
}
