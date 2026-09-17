const { withAppDelegate } = require('expo/config-plugins');

const original = 'return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")';
const marker = '// FlowReader: resolve the development URL without blocking launch on a network probe.';
const replacement = `${marker}
    // A synchronous /status request can block the Local Network permission prompt
    // and exhaust iOS's launch watchdog. Let the bundle loader connect asynchronously.
    let settings = RCTBundleURLProvider.sharedSettings()
    let savedHost = settings.jsLocation?.trimmingCharacters(in: .whitespacesAndNewlines)
    let buildHost = Bundle.main.url(forResource: "ip", withExtension: "txt")
      .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    let host = [savedHost, buildHost].compactMap { $0 }.first { !$0.isEmpty } ?? "localhost"
    return RCTBundleURLProvider.jsBundleURL(
      forBundleRoot: ".expo/.virtual-metro-entry",
      packagerHost: host,
      packagerScheme: settings.packagerScheme,
      enableDev: settings.enableDev,
      enableMinification: settings.enableMinification,
      inlineSourceMap: settings.inlineSourceMap,
      modulesOnly: false,
      runModule: true,
      additionalOptions: nil)
`;

module.exports = function withNonblockingDevBundle(config) {
  return withAppDelegate(config, (config) => {
    const delegate = config.modResults;
    if (delegate.language !== 'swift') {
      throw new Error('FlowReader requires a Swift AppDelegate for development bundle configuration.');
    }
    if (delegate.contents.includes(marker)) return config;
    if (!delegate.contents.includes(original)) {
      throw new Error('FlowReader could not locate the development bundle URL in AppDelegate.');
    }
    delegate.contents = delegate.contents.replace(original, replacement.trimEnd());
    return config;
  });
};
