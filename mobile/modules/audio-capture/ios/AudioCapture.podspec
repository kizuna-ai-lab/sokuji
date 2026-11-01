Pod::Spec.new do |s|
  s.name           = 'AudioCapture'
  s.version        = '1.0.0'
  s.summary        = "Microphone capture for Sokuji, with echo cancellation"
  s.description    = 'Records through a VoiceProcessingIO unit so the translated speech stays out of the microphone.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
