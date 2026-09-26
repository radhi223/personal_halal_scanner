/**
 * Register ONNX Runtime's native package in MainApplication.
 *
 * Why: onnxruntime-react-native 1.24.x ships without `react-native.config.js`
 * and its Expo config plugin only adds the gradle dependency — it never adds
 * `OnnxruntimePackage` to the React host package list. On Expo New Architecture
 * that leaves `NativeModules.Onnxruntime` null and crashes at startup.
 * See microsoft/onnxruntime#28266.
 */
const { withMainApplication } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const IMPORT_LINE = 'import ai.onnxruntime.reactnative.OnnxruntimePackage';
const ADD_LINE = '            add(OnnxruntimePackage())';

module.exports = function withOnnxruntimePackage(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;

    if (!src.includes('OnnxruntimePackage')) {
      src = mergeContents({
        src,
        newSrc: IMPORT_LINE,
        tag: 'onnxruntime-package-import',
        anchor: /^import com\.facebook\.react\.PackageList$/m,
        offset: 1,
        comment: '//',
      }).contents;

      src = mergeContents({
        src,
        newSrc: ADD_LINE,
        tag: 'onnxruntime-package-add',
        anchor: /PackageList\(this\)\.packages\.apply\s*\{/,
        offset: 1,
        comment: '//',
      }).contents;
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};
