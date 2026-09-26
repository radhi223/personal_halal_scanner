import TextRecognition, {
  TextRecognitionScript,
  type TextRecognitionResult,
} from '@react-native-ml-kit/text-recognition';

/**
 * On-device Japanese OCR via Google ML Kit.
 * Fully offline; the Japanese model is bundled in the native build.
 *
 * NOTE: this is a native module, so it only runs in a development build
 * or a release build — not in plain Expo Go.
 */
export async function recognizeJapanese(imageUri: string): Promise<string> {
  const result = await recognizeJapaneseDetailed(imageUri);
  return result.text ?? '';
}

/**
 * Same as recognizeJapanese but keeps the block/line structure — used to locate
 * the 原材料名 region in the image (each line carries a pixel frame).
 */
export async function recognizeJapaneseDetailed(
  imageUri: string
): Promise<TextRecognitionResult> {
  return TextRecognition.recognize(imageUri, TextRecognitionScript.JAPANESE);
}
