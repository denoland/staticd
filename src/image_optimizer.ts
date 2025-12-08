import sharp from "sharp";
import { generateContentETag } from "./file_server.ts";

/**
 * Supported image formats for optimization
 */
export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

/**
 * Supported fit modes for image resizing
 */
export type FitMode = "contain" | "cover" | "fill" | "none" | "scale-down";

/**
 * Image optimization options parsed from query parameters
 */
export interface ImageOptimizationOptions {
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Output format */
  format?: ImageFormat;
  /** Quality (1-100) */
  quality?: number;
  /** Fit mode for resizing */
  fit?: FitMode;
}

/**
 * Parse image optimization options from URL search parameters
 *
 * @param searchParams - URL search parameters
 * @returns Parsed optimization options, or null if optimize is not true
 */
export function parseImageOptimizationOptions(
  searchParams: URLSearchParams,
): ImageOptimizationOptions {
  const options: ImageOptimizationOptions = {};

  const width = searchParams.get("w");
  if (width) {
    const parsed = parseInt(width, 10);
    if (!isNaN(parsed) && parsed > 0) options.width = parsed;
  }

  const height = searchParams.get("h");
  if (height) {
    const parsed = parseInt(height, 10);
    if (!isNaN(parsed) && parsed > 0) options.height = parsed;
  }

  const format = searchParams.get("f");
  if (format && format === "jpg") {
    options.format = "jpeg";
  } else if (format && ["jpeg", "png", "webp", "avif"].includes(format)) {
    options.format = format as ImageFormat;
  }

  const quality = searchParams.get("q");
  if (quality) {
    const parsed = parseInt(quality, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) options.quality = parsed;
  }

  const fit = searchParams.get("fit");
  if (fit && ["contain", "cover", "fill", "none", "scale-down"].includes(fit)) {
    options.fit = fit as FitMode;
  }

  return options;
}

/**
 * Map FitMode to sharp's fit options
 */
function mapFitMode(fit: FitMode): keyof sharp.FitEnum {
  switch (fit) {
    case "contain":
      return sharp.fit.contain;
    case "cover":
      return sharp.fit.cover;
    case "fill":
      return sharp.fit.fill;
    case "none":
      return sharp.fit.inside;
    case "scale-down":
      return sharp.fit.inside;
    default:
      return sharp.fit.cover;
  }
}

export function isImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/webp" ||
    mimeType === "image/avif";
}

/**
 * Optimize an image using sharp
 *
 * @param imageData - The original image data as a Uint8Array
 * @param options - Optimization options
 * @returns The optimized image data and content type
 */
export async function optimizeImage(
  imageData: Uint8Array,
  options: ImageOptimizationOptions,
): Promise<{ data: Uint8Array<ArrayBuffer>; contentType: string; etag: string }> {
  let pipeline = sharp(imageData).rotate();

  if (options.width || options.height) {
    const fit = mapFitMode(options.fit ?? "cover");
    pipeline = pipeline.resize(options.width, options.height, { fit });
  }

  const outputFormat = options.format ?? "webp";

  switch (outputFormat) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: options.quality ?? 80 });
      break;
    case "png":
      pipeline = pipeline.png({ quality: options.quality ?? 80 });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: options.quality ?? 80 });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: options.quality ?? 80 });
      break;
  }

  const bytes = await pipeline.toBuffer();

  const contentType = `image/${outputFormat}`;

  const etag = await generateContentETag(bytes);

  return {
    data: new Uint8Array(bytes),
    contentType,
    etag,
  };
}
