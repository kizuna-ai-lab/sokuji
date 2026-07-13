/**
 * Model file validation — guards a downloaded/imported blob against the common
 * corruption modes before it is stored in IndexedDB and later handed to a worker:
 *   - an HTML error page returned in place of the file (404 / CDN error),
 *   - a size wildly off from the manifest's expectation,
 *   - a wrong magic number for .wasm / .onnx files,
 *   - unparseable .json.
 *
 * Split in two: {@link checkModelFile} is pure (operates on already-extracted
 * primitives, so it is trivially unit-testable), and {@link validateModelFile}
 * is the thin Blob-reading wrapper used by the download and import paths.
 */

/** Thrown when a model file fails a structural/size sanity check. */
export class ModelFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelFileValidationError';
  }
}

/** Fraction a file's actual size may deviate from the manifest size before it is rejected. */
const SIZE_TOLERANCE = 0.2;

export interface ModelFileCheck {
  filename: string;
  /** Actual blob size in bytes. */
  size: number;
  /** Manifest size for this file; 0 means "unknown, skip the size check". */
  expectedSizeBytes: number;
  /** First up-to-4 bytes of the file. */
  head: Uint8Array;
  /** Full text of the file — only required for `.json` validation. */
  text?: string;
}

/**
 * Validate a model file from already-extracted primitives. Throws
 * {@link ModelFileValidationError} on the first failure, otherwise returns.
 */
export function checkModelFile(params: ModelFileCheck): void {
  const { filename, size, expectedSizeBytes, head, text } = params;
  const ext = filename.split('.').pop()?.toLowerCase();

  // 1. HTML check — any file type could get a 404/error HTML page from the CDN.
  if (head[0] === 0x3c) {
    // '<'
    throw new ModelFileValidationError(
      `Invalid file ${filename}: received HTML instead of expected content (likely 404 or CDN error)`,
    );
  }

  // 2. Size check for files with a known manifest size.
  if (expectedSizeBytes > 0 && Math.abs(size - expectedSizeBytes) / expectedSizeBytes > SIZE_TOLERANCE) {
    throw new ModelFileValidationError(
      `Size mismatch for ${filename}: expected ~${expectedSizeBytes} bytes, got ${size} bytes`,
    );
  }

  // 3. WASM magic number check (\0asm).
  if (ext === 'wasm'
      && !(head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d)) {
    throw new ModelFileValidationError(
      `Invalid WASM file ${filename}: missing WASM magic number`,
    );
  }

  // 4. ONNX magic check — protobuf field 1 begins with 0x08.
  if (ext === 'onnx' && head[0] !== 0x08) {
    throw new ModelFileValidationError(
      `Invalid ONNX file ${filename}: missing protobuf prefix`,
    );
  }

  // 5. JSON structure check — must be parseable JSON.
  if (ext === 'json') {
    try {
      JSON.parse(text ?? '');
    } catch {
      throw new ModelFileValidationError(
        `Invalid JSON file ${filename}: content is not valid JSON`,
      );
    }
  }
}

/**
 * Validate a Blob by extracting the primitives {@link checkModelFile} needs.
 * Used by both the download and manual-import paths.
 */
export async function validateModelFile(
  filename: string,
  blob: Blob,
  expectedSizeBytes: number,
): Promise<void> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const ext = filename.split('.').pop()?.toLowerCase();
  const text = ext === 'json' ? await blob.text() : undefined;
  checkModelFile({ filename, size: blob.size, expectedSizeBytes, head, text });
}
