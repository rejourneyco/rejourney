#!/usr/bin/env node
// Reuse platform lifecycle controllers without importing React/Flutter frameworks.
// Capture and the C/JNI bridges remain Unity-owned. Fail on upstream seam drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let swift = readFileSync(join(root, 'packages/ios/Sources/Rejourney/Rejourney.swift'), 'utf8');
swift = swift.replace('backgroundDuration > sessionTimeoutSeconds', 'backgroundDuration >= sessionTimeoutSeconds');
let kotlin = readFileSync(join(root, 'packages/rejourney/android/src/main/kotlin/com/rejourney/RejourneyNativeController.kt'), 'utf8');
kotlin = kotlin.replace('import com.rejourney.recording.FlutterFrameProvider\n', '')
  .replace('    private var flutterFrameProvider: FlutterFrameProvider? = null\n', '');
function removeBetween(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < a) throw new Error(`Upstream controller seam changed: ${start}`);
  return source.slice(0, a) + source.slice(b);
}
kotlin = removeBetween(kotlin, '    fun setFlutterFrameProvider(', '    fun configure(');
kotlin = removeBetween(kotlin, '    fun forceFlutterLayerCaptureForTesting', '    fun start(');
kotlin = kotlin.replace('            flutterFrameProvider?.let(visualCapture::setFlutterFrameProvider)\n', '')
  .replace('        setFlutterFrameProvider(null)\n', '')
  .replaceAll('Flutter SDK configured', 'Unity SDK configured')
  .replaceAll('0.4.1', '0.1.0').replaceAll('com.rejourney.flutter', 'com.rejourney.unity')
  .replace('duration > SESSION_TIMEOUT_MS', 'duration >= SESSION_TIMEOUT_MS');
let failed = false;
for (const [path, data] of [
  ['packages/unity/Native~/iOS/Sources/Rejourney/Rejourney.swift', swift],
  ['packages/unity/Native~/Android/src/main/java/com/rejourney/RejourneyNativeController.kt', kotlin],
]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(join(root, path), 'utf8') !== data) { console.error(`Unity controller drift: ${path}`); failed = true; }
  } else writeFileSync(join(root, path), data);
}
if (failed) process.exit(1);
console.log('Unity platform controllers are in sync.');
