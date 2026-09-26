/**
 * Postinstall patch for onnxruntime-react-native.
 *
 * Its android/build.gradle calls `VersionNumber.parse(...)`, an internal Gradle
 * API removed in Gradle 9, which breaks the Android build. Swap it for the
 * package's own REACT_NATIVE_MINOR_VERSION check (same as upstream PR #28266).
 *
 * Idempotent: safe to run on every install.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const GRADLE = 'node_modules/onnxruntime-react-native/android/build.gradle';

if (existsSync(GRADLE)) {
  const before = readFileSync(GRADLE, 'utf8');
  const after = before.replace(
    /VersionNumber\.parse\(REACT_NATIVE_VERSION\)\s*<\s*VersionNumber\.parse\("0\.71"\)/g,
    'REACT_NATIVE_MINOR_VERSION < 71'
  );
  if (after !== before) {
    writeFileSync(GRADLE, after);
    console.log('[fix-ort] patched VersionNumber.parse -> REACT_NATIVE_MINOR_VERSION');
  } else {
    console.log('[fix-ort] already patched');
  }
} else {
  console.log('[fix-ort] onnxruntime-react-native not installed, skipping');
}
