import { Injectable } from "@nestjs/common";

// LLM 统一出口：默认 OpenRouter（OpenAI 兼容格式），可切换 Anthropic 直连
// 换 provider / 网关只改此文件与环境变量
@Injectable()
export class LlmClient {
  private readonly provider =
    process.env.LLM_PROVIDER ??
    (process.env.OPENROUTER_API_KEY ? "openrouter" : "anthropic");

  async complete(
    prompt: string,
    systemPrompt = "",
    maxTokens = 8000,
  ): Promise<string> {
    return this.provider === "anthropic"
      ? this.anthropic(prompt, systemPrompt, maxTokens)
      : this.openrouter(prompt, systemPrompt, maxTokens);
  }

  private async openrouter(
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
  ): Promise<string> {
    const base =
      process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GENERATION_MODEL ?? "anthropic/claude-sonnet-4.5",
        // 此端点强制启用推理输出，max_tokens 需覆盖推理+正文，否则 content 为空
        max_tokens: maxTokens,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok)
      throw new Error(
        `openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string };
      }>;
      error?: object;
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (!text) {
      throw new Error(
        `openrouter empty content (finish=${choice?.finish_reason}) ${JSON.stringify(data.error ?? data).slice(0, 300)}`,
      );
    }
    return text;
  }

  private async anthropic(
    prompt: string,
    systemPrompt: string,
    maxTokens: number,
  ): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GENERATION_MODEL ?? "claude-sonnet-5",
        max_tokens: maxTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok)
      throw new Error(
        `anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("anthropic empty response");
    return text;
  }
}
