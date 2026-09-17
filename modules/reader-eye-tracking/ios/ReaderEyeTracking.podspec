Pod::Spec.new do |s|
  s.name             = 'ReaderEyeTracking'
  s.version          = '1.0.0'
  s.summary          = 'Experimental on-device gaze tracking for FlowReader'
  s.description      = 'ARKit eye tracking, session calibration and TextKit word highlighting.'
  s.author           = 'FlowReader'
  s.homepage         = 'https://docs.expo.dev/modules/'
  s.platforms        = { :ios => '16.4' }
  s.source           = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks       = 'ARKit', 'AVFoundation', 'UIKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files     = '**/*.{h,m,mm,swift,hpp,cpp}'
end
