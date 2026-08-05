// SourceDatabase.language 同时承担市场路由代码；生成前转换为明确的自然语言名称，避免 af 被理解为 Afrikaans。
const OUTPUT_LANGUAGE_BY_MARKET: Record<string, string> = {
  af: "English",
  en: "English",
  sa: "English",
  me: "Arabic",
  es: "Spanish",
  fr: "French",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  pt: "Portuguese",
  th: "Thai",
  vi: "Vietnamese",
  "zh-cn": "Simplified Chinese",
  "zh-tw": "Traditional Chinese",
  "zh-mt": "Chinese",
};

export function outputLanguageFor(marketCode: string): string {
  return OUTPUT_LANGUAGE_BY_MARKET[marketCode.toLowerCase()] ?? marketCode;
}
