import TextRecognition, {
  TextRecognitionScript,
} from '@react-native-ml-kit/text-recognition';

/**
 * On-device Japanese OCR via Google ML Kit.
 * Fully offline; the Japanese model is bundled in the native build.
 *
 * NOTE: this is a native module, so it only runs in a development build
 * or a release build — not in plain Expo Go.
 */
export async function recognizeJapanese(imageUri: string): Promise<string> {
  const result = await TextRecognition.recognize(
    imageUri,
    TextRecognitionScript.JAPANESE
  );
  return result.text ?? '';
}
