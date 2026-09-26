const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow bundling ONNX models (PP-OCR det/rec) as assets for offline OCR.
config.resolver.assetExts.push('onnx');

module.exports = config;
