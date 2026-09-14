Pod::Spec.new do |s|
  s.name             = 'PDFTextExtractor'
  s.version          = '1.0.0'
  s.summary          = 'On-device PDF text extraction for FlowReader'
  s.description      = 'Extracts text and title metadata from local PDF files using PDFKit.'
  s.author           = 'FlowReader'
  s.homepage         = 'https://docs.expo.dev/modules/'
  s.platforms        = { :ios => '16.4' }
  s.source           = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PDFKit', 'Vision', 'VisionKit', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
