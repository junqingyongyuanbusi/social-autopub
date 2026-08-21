export const DEFAULT_PLATFORM_RULES: Record<string, string> = {
  x: "不超过 260 个字符（CJK 每字按 2 计），语气简洁有力，最多 2 个 hashtag，不用链接占位符",
  instagram:
    "正文 100-300 词/字，前两行必须抓住注意力（feed 会折叠），3-8 个 hashtag 放末尾，多用换行分段",
  facebook:
    "正文 80-250 词/字，口吻友好可分享，最多 3 个 hashtag，可用提问句结尾提升互动",
};

export const DEFAULT_TYPE_TONES: Record<string, string> = {
  news: "新闻快讯风格：客观、时效性强、信息前置",
  education: "教育科普风格：循序引导、给出可操作要点",
  review: "测评风格：结论先行、优缺点分明、避免绝对化用语",
  exposure: "曝光风格：事实陈述、证据导向、克制且严谨，避免诽谤性表述",
};

export const DEFAULT_SYSTEM_PROMPT =
  "你是资深多语言社媒运营，必须忠于素材，不得编造事实、数据、牌照或结论。";

export const DEFAULT_GENERATION_TEMPLATE = `请基于以下素材，用语言「{{language}}」直接撰写（不是翻译）一条 {{platform}} 发布文案。

内容类型：{{contentType}}
内容风格：{{typeTone}}
平台规则：{{platformRule}}

素材标题：{{title}}
素材正文：
{{body}}

只输出 JSON（不要 markdown 代码块），结构：{"content": "文案全文"}`;

export const DEFAULT_REVISION_TEMPLATE = `你之前为 {{platform}} 写的这条「{{language}}」文案未通过校验：

{{content}}

问题：
{{problems}}

请修正以上问题并保持原意与语言不变，只输出 JSON（不要 markdown 代码块），结构：{"content": "文案全文"}`;

export interface PromptConfig {
  id: string | null;
  version: number;
  systemPrompt: string;
  generationTemplate: string;
  revisionTemplate: string;
  platformRules: Record<string, string>;
  typeTones: Record<string, string>;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  id: null,
  version: 0,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  generationTemplate: DEFAULT_GENERATION_TEMPLATE,
  revisionTemplate: DEFAULT_REVISION_TEMPLATE,
  platformRules: DEFAULT_PLATFORM_RULES,
  typeTones: DEFAULT_TYPE_TONES,
};

function render(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.split(`{{${key}}}`).join(value),
    template,
  );
}

export function buildGenerationPrompt(
  config: PromptConfig,
  input: {
    platform: string;
    language: string;
    contentType: string;
    title: string;
    body: string;
    bodyBudget?: number | null
  },
) {
  return render(config.generationTemplate, {
    platform: input.platform,
    language: input.language,
    contentType: input.contentType,
    typeTone: config.typeTones[input.contentType] ?? "",
    platformRule: `${config.platformRules[input.platform] ?? ""}${
      input.bodyBudget !== null && input.bodyBudget !== undefined
        ? `；系统尾注已预留字符，正文必须控制在 ${input.bodyBudget} 个平台计权字符以内`
        : ""
    }`,
    title: input.title,
    body: input.body.slice(0, 6000),
  });
}

export function buildRevisePrompt(
  config: PromptConfig,
  input: {
    platform: string;
    language: string;
    content: string;
    problems: string[];
  },
) {
  return render(config.revisionTemplate, {
    platform: input.platform,
    language: input.language,
    content: input.content,
    problems: input.problems.map((problem) => `- ${problem}`).join("\n"),
  });
}
