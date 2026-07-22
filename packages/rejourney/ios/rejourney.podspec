Pod::Spec.new do |s|
  s.name             = 'rejourney'
  s.version          = '0.1.1'
  s.summary          = 'Rejourney session replay and observability for Flutter.'
  s.description      = 'Privacy-first mobile session replay, crash and ANR reporting, network telemetry, and product analytics.'
  s.homepage         = 'https://rejourney.co'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'Rejourney' => 'support@rejourney.co' }
  s.source           = { :path => '.' }
  s.source_files     = 'rejourney/Sources/rejourney/**/*.{swift,h,m,mm}'
  s.resource_bundles = {
    'rejourney_privacy' => ['rejourney/Sources/rejourney/Core/Resources/PrivacyInfo.xcprivacy']
  }
  s.dependency 'Flutter'
  s.platform = :ios, '15.1'
  s.library = 'z'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386'
  }
  s.swift_version = '5.9'
end
