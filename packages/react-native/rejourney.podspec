require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "rejourney"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://rejourney.co"
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.0"
  s.exclude_files = "ios/build/**/*"
  s.library      = "z"

  # On RN 0.71+, let the helper own React Native pod wiring so we do not
  # double-declare core/turbomodule deps and drift from the app's RN setup.
  # Use defined?(…) — Pod::Specification#respond_to?(:install_modules_dependencies) is false
  # even when the Podfile has loaded react_native_pods.rb, which would force the fallback
  # every time and duplicate RN dependencies.
  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  else
    # Fallback for older React Native installs or `pod spec lint` where the helper is unavailable.
    s.dependency "React-Core"

    if ENV["RCT_NEW_ARCH_ENABLED"] == "1"
      s.dependency "ReactCommon/turbomodule/core"
    end
  end
end
