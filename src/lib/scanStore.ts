import type { ScanFinding } from '@/types';

export interface LastScan {
  /** Scan id, so feedback records can be correlated with the scan record. */
  sid: string;
  rawText: string;
  /** The 原材料名 section we actually matched against (may equal rawText). */
  section: string;
  findings: ScanFinding[];
  createdAt: number;
  /** True when we auto-cropped to the ingredient region and upscaled before OCR. */
  cropped?: boolean;
  /**
   * True when the OCR only recovered a thin ingredient list, so the result may
   * be incomplete. Purely informational — it does not affect matching.
   */
  lowQuality?: boolean;
}

/**
 * Tiny in-memory handoff between the scan screen and the result screen.
 * Avoids serializing the whole result through router params.
 */
let last: LastScan | null = null;

export function setLastScan(scan: LastScan): void {
  last = scan;
}

export function getLastScan(): LastScan | null {
  return last;
}
