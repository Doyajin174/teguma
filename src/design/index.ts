/** Public surface of the design engine. */

export {
  BrandKitSchema,
  DesignDocumentSchema,
  DesignLayerSchema,
  DesignPageSchema,
  countLayers,
  parseDesignDocument,
  type BrandColor,
  type BrandFont,
  type BrandKit,
  type BrandLogo,
  type Canvas,
  type DesignDocument,
  type DesignLayer,
  type DesignPage,
  type Frame,
  type ImageLayer,
  type RectLayer,
  type TextLayer,
} from "./document.js";

export {
  SIZE_PRESETS,
  findSizePreset,
  listSizePresets,
  requireSizePreset,
  type SizePreset,
} from "./presets.js";

export {
  resizeDocument,
  resolveResize,
  type ResizeMode,
  type ResizeTarget,
  type ResolvedResize,
} from "./resize.js";

export {
  applyBrandKit,
  colorDistance,
  findBrandViolations,
  nearestBrandColor,
  type BrandViolation,
} from "./brand-kit.js";

export {
  MM_TO_PX,
  canvasPixelSize,
  escapeXml,
  renderDocumentToSvg,
  renderPageToSvg,
  type ImageResolver,
} from "./svg.js";

export { contrastRatio, inspectDocument, type QaCheck, type QaReport } from "./qa.js";

export {
  ApprovalStateSchema,
  DesignPolicySchema,
  PolicyTermSchema,
  RestrictedCapabilitiesSchema,
  canTransitionApproval,
  evaluatePolicy,
  isExportPermitted,
  isSafeRegexPattern,
  normalizePolicyText,
  transitionApproval,
  type ApprovalState,
  type DesignPolicy,
  type PolicyTerm,
  type PolicyViolation,
  type RestrictedCapabilities,
} from "./policy.js";

export {
  buildPdf,
  exportDocument,
  type ExportFormat,
  type ExportOptions,
  type ExportResult,
  type ExportedPage,
} from "./export.js";

export { encodeJpeg, type JpegEncodeOptions } from "./jpeg.js";

export {
  createImageResolver,
  DEFAULT_MAX_IMAGE_BYTES,
  type ImageResolverOptions,
} from "./image-resolver.js";

export {
  cropImage,
  padImage,
  removeFlatBackground,
  scaleImage,
  trimTransparent,
  validateImageDimensions,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_RASTER_DIMENSION,
  type CropRect,
  type ImageCorner,
  type ImageFit,
  type PadImageOptions,
  type RemoveFlatBackgroundOptions,
  type Rgba,
  type ScaleImageOptions,
  type TrimTransparentResult,
} from "./image-ops.js";

export {
  TEXT_WIDTH_RATIOS,
  estimateTextWidth,
  measureTextBlock,
  wrapText,
  type MeasureTextBlockOptions,
  type TextBlockMeasurement,
  type WrappedText,
  type WrapTextOptions,
} from "./text-metrics.js";

export {
  autoLayoutDocument,
  fitTextLayers,
  wrapTextLayers,
  type AutoLayoutOptions,
  type AutoLayoutResult,
  type TextLayerChange,
  type TextOverflowPolicy,
} from "./autolayout.js";

export {
  hexToRgb,
  relativeLuminanceFromRgb,
  type RgbColor,
} from "./color.js";

export {
  DESIGN_TEMPLATES,
  findTemplate,
  instantiateTemplate,
  listTemplates,
  requireTemplate,
  type DesignTemplate,
  type TemplateInput,
  type TemplateInstantiation,
} from "./templates.js";

export {
  CURRENT_PROJECT_SCHEMA_VERSION,
  MAX_PROJECT_ID_LENGTH,
  DesignProjectSchema,
  ProjectIdSchema,
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type DesignProject,
  type DesignProjectStore,
} from "./project.js";

export {
  BUNDLED_DEFAULT_FONT_FILES,
  FontRegistry,
  bundledFontRegistry,
  collectDocumentFontFamilies,
  resolveDocumentFonts,
  validateFontFiles,
  type FontRegistration,
  type MissingFontPolicy,
  type ResolvedDocumentFonts,
  type ResolveDocumentFontsOptions,
} from "./fonts.js";

export {
  alignLayers,
  distributeLayers,
  distributeVerticalRhythm,
  stackLayers,
  type AlignLayersOptions,
  type DistributeLayersOptions,
  type DistributionMode,
  type LayoutAlignment,
  type LayoutAxis,
  type SafeAreaOptions,
  type StackLayersOptions,
  type VerticalRhythmAnchor,
  type VerticalRhythmOptions,
} from "./layout.js";

export {
  glyphAdvanceProviderFor,
  type GlyphAdvanceProvider,
} from "./fonts.js";

export type { TextMetricsOptions } from "./text-metrics.js";

export { conservativeGlyphAdvanceProviderFor } from "./fonts.js";

export { buildPptx, canvasUnitToEmu } from "./pptx.js";

export {
  DEFAULT_GIF_FRAME_DELAY,
  encodeGif,
  encodeGifLzw,
  quantizeGifPalette,
  type GifEncodeOptions,
  type GifFrame,
} from "./gif.js";

export {
  DEFAULT_MP4_FRAME_DURATION,
  encodeMp4,
  type Mp4EncodeOptions,
  type Mp4EncodeResult,
  type Mp4Frame,
} from "./mp4.js";
