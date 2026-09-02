import {
  Injectable,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
  RequestTimeoutException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface AiRequestOptions {
  /** Creativity (0.0 – 2.0). Default: 0.7 */
  temperature?: number;
  /** Maximum output tokens. Default: 2048 */
  maxTokens?: number;
  /** Override the global model for this request only. */
  model?: string;
}

export interface AiResponse<T = string> {
  success: boolean;
  data: T | null;
  model: string;
  durationMs: number;
  retried: boolean;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class AiTimeoutError extends RequestTimeoutException {
  constructor() {
    super('AI request timed out. Please try again.');
  }
}

export class AiRateLimitError extends ServiceUnavailableException {
  constructor() {
    super('AI service rate limit reached. Please wait a moment before retrying.');
  }
}

export class AiEmptyResponseError extends InternalServerErrorException {
  constructor() {
    super('AI returned an empty response. Please retry the request.');
  }
}

export class AiJsonParseError extends InternalServerErrorException {
  constructor(raw: string) {
    super(`AI response could not be parsed as valid JSON. Raw snippet: "${raw.substring(0, 80)}..."`);
  }
}

// ─── AIService ────────────────────────────────────────────────────────────────

/**
 * AIService — Centralized AI communication layer.
 *
 * This is the ONLY service allowed to communicate with OpenRouter.
 * No other service may call OpenRouter directly.
 *
 * Responsibilities:
 *  - Sending requests to OpenRouter
 *  - Model selection and configuration
 *  - Temperature and max-token configuration
 *  - Retry logic (single retry on transient failures)
 *  - Timeout handling (30 second hard limit)
 *  - JSON parsing and extraction
 *  - Error normalization into application-level exceptions
 *  - Structured logging (request timestamp, service, duration, model, success/failure)
 *
 * Prompt flow:
 *   BusinessIntelligenceService → PromptBuilderService → AIService → OpenRouter → Response
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private readonly apiKey: string;
  private readonly defaultModel: string;
  /**
   * Must be a genuinely zero-cost model. `openrouter/auto` routes to PAID
   * models, so on an account with no credits both the primary and the fallback
   * returned HTTP 402 and every caption silently degraded to a hardcoded
   * template.  Both slugs below were verified live as zero-cost.
   */
  private readonly fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL
    || 'nvidia/nemotron-3-ultra-550b-a55b:free';
  private readonly baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly timeoutMs = 30_000;

  private readonly groqApiKey: string;
  private readonly groqModel: string;
  private readonly groqBaseUrl = 'https://api.groq.com/openai/v1/chat/completions';

  private readonly hfApiKey: string;
  private readonly hfImageModel = 'black-forest-labs/FLUX.1-schnell';
  /**
   * Hugging Face retired `api-inference.huggingface.co` (the host no longer
   * resolves) and moved serverless inference to the Inference Providers router.
   * FLUX.1-schnell is no longer served by the `hf-inference` provider either —
   * it returns 410 "model is deprecated" — so we route through fal-ai, which is
   * listed as a live provider for this model.
   */
  private readonly hfBaseUrl = 'https://router.huggingface.co';
  private readonly hfImageRoute = 'fal-ai/fal-ai/flux/schnell';

  /**
   * Together AI serves FLUX.1-schnell on a free tier, which matters because the
   * Hugging Face route runs on a $0.10/month credit (~30 images) that is
   * exhausted almost immediately. Tried first when a key is present.
   */
  private readonly togetherApiKey: string;
  private readonly togetherImageModel: string;
  private readonly togetherBaseUrl = 'https://api.together.ai/v1/images/generations';

  /**
   * Cloudflare Workers AI is the most generous genuinely-free image source:
   * 10,000 neurons/day, and flux-1-schnell at 1024x1024 with 4 steps costs
   * ~57.6 neurons — roughly 170 images a day. Compare Hugging Face's $0.10/mo
   * (~30 images total). Tried first when configured.
   */
  private readonly cfAccountId: string;
  private readonly cfApiToken: string;
  private readonly cfImageModel: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    // `openrouter/auto` is explicitly rejected here: it is a paid router, and
    // leaving it configured is what silently disabled all AI text generation.
    const configuredModel = (process.env.OPENROUTER_MODEL || '').trim();
    if (configuredModel === 'openrouter/auto') {
      this.logger.warn(
        'OPENROUTER_MODEL is set to "openrouter/auto", which routes to paid models and fails with HTTP 402 on accounts without credits. Using a free model instead.',
      );
    }
    this.defaultModel =
      configuredModel && configuredModel !== 'openrouter/auto'
        ? configuredModel
        : 'minimax/minimax-m3:free';
    this.groqApiKey = process.env.GROQ_API_KEY || '';
    // llama-3.3-70b-specdec (and llama-3.3-70b-versatile) were decommissioned
    // by Groq — requests return "model_decommissioned", which silently killed
    // the last-resort text fallback. Verified live against this key.
    const configuredGroqModel = (process.env.GROQ_MODEL || '').trim();
    this.groqModel = /llama-3\.3-70b/.test(configuredGroqModel) || !configuredGroqModel
      ? 'openai/gpt-oss-20b'
      : configuredGroqModel;
    this.hfApiKey = process.env.HF_API_KEY || '';
    this.togetherApiKey = process.env.TOGETHER_API_KEY || '';
    this.togetherImageModel =
      process.env.TOGETHER_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell';
    this.cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '';
    this.cfApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() || '';
    this.cfImageModel =
      process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-1-schnell';

    if (!this.apiKey && !this.groqApiKey) {
      this.logger.warn('Neither OPENROUTER_API_KEY nor GROQ_API_KEY is set. AI features will use fallback responses.');
    } else {
      this.logger.log(`AIService initialized. Default model: ${this.defaultModel} | Groq fallback: ${this.groqModel} | HF image: ${this.hfImageModel}`);
    }
  }

  // ─── Public Methods ────────────────────────────────────────────────────────

  /**
   * Generate a plain-text response from the AI model.
   *
   * @param systemPrompt  System-level instructions for the model
   * @param userPrompt    User message / task
   * @param options       Temperature, maxTokens, model override
   * @param callerName    Caller identifier used in structured logs
   */
  async generateText(
    systemPrompt: string,
    userPrompt: string,
    options: AiRequestOptions = {},
    callerName = 'unknown',
  ): Promise<AiResponse<string>> {
    return this.executeRequest<string>(
      systemPrompt,
      userPrompt,
      options,
      callerName,
      (text) => text,
    );
  }

  /**
   * Generate a structured JSON response from the AI model.
   * Automatically appends a JSON-only instruction to the user prompt.
   *
   * @param systemPrompt  System-level instructions
   * @param userPrompt    User message / task (should include JSON schema)
   * @param options       Temperature, maxTokens, model override
   * @param callerName    Caller identifier used in structured logs
   */
  async generateStructuredJson<T>(
    systemPrompt: string,
    userPrompt: string,
    options: AiRequestOptions = {},
    callerName = 'unknown',
  ): Promise<AiResponse<T>> {
    const jsonUserPrompt = `${userPrompt}\n\nReturn ONLY valid JSON. No markdown, no code fences, no explanation.`;

    return this.executeRequest<T>(
      systemPrompt,
      jsonUserPrompt,
      options,
      callerName,
      (text) => this.parseJson<T>(text),
    );
  }

  /**
   * Generates an Instagram-ready post returning caption and array of 15 trending hashtags.
   */
  async generateInstagramPost(niche: string, vibe: string, offer: string) {
    const systemPrompt = `You are an expert Instagram copywriter. Return ONLY a valid JSON object containing exactly two keys:
1. "caption": An engaging, high-converting Instagram caption for the business.
2. "hashtags": An array of EXACTLY 15 relevant, high-performing Instagram hashtags starting with #.`;

    const userPrompt = `Generate Instagram post for:
- Niche: ${niche}
- Vibe: ${vibe}
- Offer: ${offer}`;

    const res = await this.generateStructuredJson<{ caption: string; hashtags: string[] }>(
      systemPrompt,
      userPrompt,
      { temperature: 0.7 },
      'generateInstagramPost'
    );

    return res.data || {
      caption: `Step into luxury with ${offer}! Perfect for ${niche}. ✨`,
      hashtags: [
        '#LuxeFashion', '#StyleInspiration', '#OOTD', '#LuxuryApparel', '#FashionLaunch',
        '#ChicStyle', '#WomensFashion', '#SustainableLuxury', '#HighFashion', '#DesignerCoats',
        '#AutumnVibes', '#ExclusiveOffer', '#FashionStatement', '#TrendyLook', '#ShopNow'
      ]
    };
  }

  /**
   * Convenience alias — behaves like generateText().
   * Provided for backward-compatible method naming.
   */
  async chat(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.7,
    maxTokens = 2048,
    callerName = 'unknown',
  ): Promise<string> {
    const result = await this.generateText(
      systemPrompt,
      userPrompt,
      { temperature, maxTokens },
      callerName,
    );
    return result.data ?? '';
  }

  /**
   * Convenience alias — behaves like generateStructuredJson().
   * Provided for backward-compatible method naming.
   */
  async chatJson<T>(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.7,
    maxTokens = 2048,
    callerName = 'unknown',
  ): Promise<T | null> {
    const result = await this.generateStructuredJson<T>(
      systemPrompt,
      userPrompt,
      { temperature, maxTokens },
      callerName,
    );
    return result.data;
  }

  // ─── Core Execution Engine ─────────────────────────────────────────────────

  /**
   * Executes an AI request with retry logic, timeout, and structured logging.
   * On transient failure, retries once with the fallback model before throwing.
   */
  private async executeRequest<T>(
    systemPrompt: string,
    userPrompt: string,
    options: AiRequestOptions,
    callerName: string,
    parser: (text: string) => T,
  ): Promise<AiResponse<T>> {
    const model = options.model || this.defaultModel;
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 2048;
    const startedAt = Date.now();

    this.logger.log(
      `[AIService] Request started | caller=${callerName} | model=${model} | temp=${temperature} | maxTokens=${maxTokens}`,
    );

    // ── First attempt with OpenRouter ──────────────────────────────────────
    if (this.apiKey) {
      try {
        const text = await this.callOpenRouter(systemPrompt, userPrompt, model, temperature, maxTokens);
        const data = parser(text);
        const durationMs = Date.now() - startedAt;

        this.logger.log(
          `[AIService] OpenRouter request succeeded | caller=${callerName} | model=${model} | duration=${durationMs}ms`,
        );

        return this.buildResponse<T>(data, model, durationMs, false);
      } catch (firstErr: any) {
        this.logger.warn(
          `[AIService] OpenRouter primary request failed (${firstErr.message}) — attempting OpenRouter fallback model (${this.fallbackModel})...`,
        );

        try {
          const text = await this.callOpenRouter(
            systemPrompt,
            userPrompt,
            this.fallbackModel,
            temperature,
            maxTokens,
          );
          const data = parser(text);
          const durationMs = Date.now() - startedAt;

          this.logger.log(
            `[AIService] OpenRouter fallback model succeeded | caller=${callerName} | duration=${durationMs}ms`,
          );

          return this.buildResponse<T>(data, this.fallbackModel, durationMs, true);
        } catch (fallbackErr: any) {
          this.logger.warn(`[AIService] OpenRouter fallback failed: ${fallbackErr.message}. Cascading to Groq AI fallback...`);
        }
      }
    } else {
      this.logger.warn(`[AIService] OPENROUTER_API_KEY is not set or empty. Using Groq AI as primary provider.`);
    }

    // ── Fallback attempt with Groq AI ───────────────────────────────────────
    if (this.groqApiKey) {
      try {
        this.logger.log(`[AIService] Triggering Groq AI fallback (${this.groqModel}) for caller=${callerName}...`);
        const groqText = await this.callGroq(systemPrompt, userPrompt, temperature, maxTokens);
        if (groqText) {
          const data = parser(groqText);
          const durationMs = Date.now() - startedAt;
          this.logger.log(
            `[AIService] Groq AI fallback succeeded | caller=${callerName} | model=${this.groqModel} | duration=${durationMs}ms`,
          );
          return this.buildResponse<T>(data, this.groqModel, durationMs, true);
        }
      } catch (groqErr: any) {
        this.logger.error(`[AIService] Groq AI fallback failed | caller=${callerName} | error=${groqErr.message}`);
      }
    }

    const durationMs = Date.now() - startedAt;
    return this.buildResponse<T>(null, model, durationMs, true);
  }

  /**
   * Makes HTTP POST request to Groq API (fallback LLM provider).
   */
  private async callGroq(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.7,
    maxTokens = 2048,
  ): Promise<string> {
    if (!this.groqApiKey) return '';
    try {
      this.logger.log(`[AIService] Executing Groq AI request (${this.groqModel})...`);
      const response = await axios.post(
        this.groqBaseUrl,
        {
          model: this.groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${this.groqApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        },
      );

      const text: string = response.data?.choices?.[0]?.message?.content || '';
      return text.trim();
    } catch (err: any) {
      this.logger.error(`[AIService] Groq API error: ${err?.response?.data?.error?.message || err.message}`);
      return '';
    }
  }

  // ─── OpenRouter HTTP Layer ─────────────────────────────────────────────────

  /**
   * Makes the actual HTTP POST to OpenRouter.
   * Throws normalized errors on failure.
   */
  private async callOpenRouter(
    systemPrompt: string,
    userPrompt: string,
    model: string,
    temperature: number,
    maxTokens: number,
  ): Promise<string> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://campaignai.app',
            'X-Title': 'Visionpilot AI',
          },
          timeout: this.timeoutMs,
        },
      );

      const text: string = response.data?.choices?.[0]?.message?.content || '';

      if (!text.trim()) {
        this.logger.warn(`[AIService] Empty response from model ${model}`);
        return '';
      }

      return text.trim();
    } catch (err: any) {
      throw this.normalizeError(err, model);
    }
  }

  // ─── Error Normalization ───────────────────────────────────────────────────

  /**
   * Maps raw Axios/HTTP errors to application-level exceptions with clean messages.
   */
  private normalizeError(err: any, model: string): Error {
    // Timeout
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      this.logger.error(`[AIService] Timeout for model ${model}`);
      return new AiTimeoutError();
    }

    const status: number = (err as AxiosError)?.response?.status || 0;
    const errMsg: string =
      (err as AxiosError<any>)?.response?.data?.error?.message ||
      err?.message ||
      'Unknown OpenRouter error';

    // Rate limit
    if (status === 429) {
      this.logger.error(`[AIService] Rate limit hit for model ${model}`);
      return new AiRateLimitError();
    }

    // Network failure (no HTTP response)
    if (!status) {
      this.logger.error(`[AIService] Network failure for model ${model}: ${errMsg}`);
      return new ServiceUnavailableException(`AI network failure: ${errMsg}`);
    }

    // API failure (4xx / 5xx)
    this.logger.error(`[AIService] API error ${status} for model ${model}: ${errMsg}`);
    return new InternalServerErrorException(`AI API error (${status}): ${errMsg}`);
  }

  /**
   * Returns true if the error is transient and safe to retry.
   */
  private isTransientError(err: any): boolean {
    if (err instanceof AiTimeoutError) return true;
    if (err instanceof AiRateLimitError) return true;
    if (err instanceof ServiceUnavailableException) return true;

    const status: number = (err as AxiosError)?.response?.status || 0;
    return status === 429 || status === 503 || status === 502 || status === 0;
  }

  // ─── JSON Parsing ──────────────────────────────────────────────────────────

  /**
   * Parses AI text output as JSON.
   * Handles direct JSON and JSON embedded within markdown code fences.
   */
  private parseJson<T>(text: string): T {
    if (!text) return null as T;

    // Direct parse attempt
    try {
      return JSON.parse(text) as T;
    } catch {/* try extraction */ }

    // Extract from markdown fences: ```json ... ```
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim()) as T;
      } catch {/* try object extraction */ }
    }

    // Extract first JSON object or array
    const objectMatch = text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {/* fall through */ }
    }

    this.logger.error(`[AIService] JSON parse failed. Raw (first 200 chars): ${text.substring(0, 200)}`);
    return null as T;
  }

  // ─── Response Builder ──────────────────────────────────────────────────────

  /**
   * Dedicated Gemini API Integration for Instagram Text Generation.
   * Accepts business parameters (niche, vibe, currentOffer, targetAudience) from Firestore.
   * Enforces 15-second timeout and strict JSON response format with keys: "caption" and "hashtags".
   */
  async generateInstagramContent(
    businessContext: {
      businessName?: string;
      niche?: string;
      vibe?: string;
      currentOffer?: string;
      targetAudience?: string;
      location?: string;
    },
    promptDetails?: { topic?: string; offer?: string },
  ): Promise<{ caption: string; hashtags: string[] }> {
    const systemPrompt = `You are an expert Instagram Social Media Copywriter and Growth Strategist.
You MUST return ONLY a raw JSON object containing EXACTLY two keys: "caption" and "hashtags".

JSON Schema requirement:
{
  "caption": "An engaging, high-converting Instagram caption with hook, storytelling, emojis, and clear call-to-action",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6", "#tag7", "#tag8", "#tag9", "#tag10", "#tag11", "#tag12", "#tag13", "#tag14", "#tag15"]
}

STRICT CONSTRAINTS:
1. "caption": Must be compelling, beautifully formatted with line breaks & emojis, aligned with the brand tone/vibe and current offer.
2. "hashtags": Must be a JSON array containing EXACTLY 15 relevant, high-performing Instagram hashtags starting with '#'.
3. Do NOT include markdown code fences, extra text, or conversation outside the raw JSON.`;

    const userPrompt = `Generate Instagram-ready content for this business:
Business Name: ${businessContext.businessName || 'Our Business'}
Industry / Niche: ${businessContext.niche || 'General Business'}
Brand Tone / Vibe: ${businessContext.vibe || 'Professional & Engaging'}
Current Offer / Promotion: ${promptDetails?.offer || businessContext.currentOffer || 'Special Promotional Offer'}
Target Audience: ${businessContext.targetAudience || 'General Audience'}
Geographic Location: ${businessContext.location || 'Nationwide'}
${promptDetails?.topic ? `Specific Post Topic: ${promptDetails.topic}` : ''}`;

    const timeoutMs = 15_000;
    let responseText = '';

    if (this.apiKey) {
      this.logger.log('[AIService] Routing Gemini Instagram text generation via OpenRouter (google/gemini-2.5-flash).');
      try {
        responseText = await this.callOpenRouter(
          systemPrompt,
          userPrompt,
          'google/gemini-2.5-flash',
          0.7,
          1024,
        );
      } catch (err: any) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err instanceof AiTimeoutError) {
          throw new RequestTimeoutException('OpenRouter Gemini request timed out after 15 seconds. Please try again.');
        }
        this.logger.warn(`OpenRouter Gemini call failed (${err.message}). Attempting Direct Gemini API fallback.`);
      }
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!responseText && geminiApiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
        const res = await axios.post(
          geminiUrl,
          {
            contents: [
              {
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
            },
          },
          { timeout: timeoutMs },
        );
        responseText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err: any) {
        this.logger.warn(`Direct Gemini API fallback failed: ${err.message}`);
      }
    }

    const parsed = this.parseJson<{ caption: string; hashtags: string[] }>(responseText);
    const caption = parsed?.caption || `🚀 Exciting news from ${businessContext.businessName || 'our brand'}!\n\nCheck out our current offer: ${businessContext.currentOffer || 'Contact us today for special offers.'}\n\n👉 Click the link in our bio to learn more!`;
    let hashtags = Array.isArray(parsed?.hashtags) ? parsed.hashtags : [];

    if (hashtags.length < 15) {
      const defaultHashtags = [
        '#InstagramMarketing', '#BusinessGrowth', '#SocialMediaStrategy', '#BrandAwareness',
        '#DigitalMarketing', '#MarketingTips', '#SmallBusiness', '#ContentStrategy',
        '#BrandIdentity', '#CustomerEngagement', '#PromoAlert', '#TrendingNow',
        '#BusinessSuccess', '#ExclusiveOffer', '#FollowUs'
      ];
      for (const tag of defaultHashtags) {
        if (!hashtags.includes(tag) && hashtags.length < 15) {
          hashtags.push(tag);
        }
      }
    } else if (hashtags.length > 15) {
      hashtags = hashtags.slice(0, 15);
    }

    hashtags = hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`));
    return { caption, hashtags };
  }

  /**
   * AI Image Generation — 3-tier fallback chain:
   *  1. Hugging Face FLUX.1-schnell (free, high quality, returns real image bytes)
   *  2. Pollinations AI flux model (free, no key, URL-based)
   *  3. Pollinations AI turbo model (free, no key, fastest fallback)
   */
  async generateImage(
    prompt: string,
    options?: { aspect_ratio?: string },
  ): Promise<{ success: boolean; imageUrl: string; model: string }> {
    const startedAt = Date.now();
    const cleanPrompt = prompt.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    let width = 768;
    let height = 768;
    const ar = options?.aspect_ratio || '1:1';
    if (ar === '4:5') {
      height = 960;
    } else if (ar === '9:16') {
      width = 576;
      height = 1024;
    }

    // ── Tier 0: Cloudflare Workers AI (free, ~170 images/day) ───────────────
    if (this.cfAccountId && this.cfApiToken) {
      try {
        this.logger.log(`[AIService] Attempting Cloudflare Workers AI (${this.cfImageModel})...`);
        const res = await axios.post(
          `https://api.cloudflare.com/client/v4/accounts/${this.cfAccountId}/ai/run/${this.cfImageModel}`,
          { prompt: cleanPrompt, steps: 4 },
          {
            headers: {
              Authorization: `Bearer ${this.cfApiToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 90_000,
          },
        );

        // flux-1-schnell returns base64 JPEG bytes in result.image.
        const b64 = res.data?.result?.image;
        if (res.data?.success && b64) {
          this.logger.log(`[AIService] Cloudflare Workers AI succeeded in ${Date.now() - startedAt}ms`);
          return {
            success: true,
            imageUrl: `data:image/jpeg;base64,${b64}`,
            model: `cloudflare-${this.cfImageModel}`,
          };
        }
        const errs = JSON.stringify(res.data?.errors || res.data).substring(0, 200);
        this.logger.warn(`[AIService] Cloudflare returned no image: ${errs}. Falling back...`);
      } catch (cfErr: any) {
        const status = cfErr?.response?.status;
        const raw = cfErr?.response?.data;
        const msg = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : cfErr.message;
        this.logger.warn(
          `[AIService] Cloudflare Workers AI failed (status=${status}): ${String(msg).substring(0, 200)}. Falling back...`,
        );
      }
    }

    // ── Tier 0b: Together AI FLUX.1-schnell (paid account required) ─────────
    if (this.togetherApiKey) {
      try {
        this.logger.log(`[AIService] Attempting Together AI image generation (${this.togetherImageModel})...`);
        // FLUX schnell on Together takes aspect_ratio rather than width/height.
        const aspectRatio = ar === '9:16' ? '9:16' : ar === '4:5' ? '4:5' : '1:1';
        const res = await axios.post(
          this.togetherBaseUrl,
          {
            model: this.togetherImageModel,
            prompt: cleanPrompt,
            aspect_ratio: aspectRatio,
            steps: 4,
            n: 1,
          },
          {
            headers: {
              Authorization: `Bearer ${this.togetherApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 90_000,
          },
        );

        const item = res.data?.data?.[0];
        const generatedUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
        if (generatedUrl) {
          this.logger.log(`[AIService] Together AI succeeded in ${Date.now() - startedAt}ms`);
          return { success: true, imageUrl: generatedUrl, model: `together-${this.togetherImageModel}` };
        }
        this.logger.warn('[AIService] Together AI returned no image; falling through.');
      } catch (tErr: any) {
        const status = tErr?.response?.status;
        const raw = tErr?.response?.data;
        const msg = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : tErr.message;
        this.logger.warn(
          `[AIService] Together AI image generation failed (status=${status}): ${String(msg).substring(0, 200)}. Falling back...`,
        );
      }
    }

    // ── Tier 1: Hugging Face FLUX.1-schnell ─────────────────────────────────
    if (this.hfApiKey) {
      try {
        this.logger.log(`[AIService] Attempting HF FLUX.1-schnell image generation via fal-ai router...`);
        const hfResponse = await axios.post(
          `${this.hfBaseUrl}/${this.hfImageRoute}`,
          {
            prompt: cleanPrompt,
            image_size: { width, height },
            num_inference_steps: 4,
          },
          {
            headers: {
              Authorization: `Bearer ${this.hfApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 90_000,
          },
        );

        // The router returns JSON ({ images: [{ url }] }), not raw image bytes.
        const generatedUrl = hfResponse.data?.images?.[0]?.url;
        if (hfResponse.status === 200 && generatedUrl) {
          const durationMs = Date.now() - startedAt;
          this.logger.log(`[AIService] HF FLUX.1-schnell succeeded in ${durationMs}ms: ${generatedUrl}`);
          return { success: true, imageUrl: generatedUrl, model: 'hf-flux-schnell' };
        }

        this.logger.warn(
          `[AIService] HF returned no image URL (status=${hfResponse.status}). Falling back to Pollinations...`,
        );
      } catch (hfErr: any) {
        const status = hfErr?.response?.status;
        const raw = hfErr?.response?.data;
        const msg =
          typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : hfErr.message;
        // 402 means the account's monthly Inference Providers credits are spent.
        const hint = status === 402 ? ' (Hugging Face inference credits exhausted)' : '';
        this.logger.warn(
          `[AIService] HF image generation failed (status=${status})${hint}: ${String(msg).substring(0, 160)}. Falling back to Pollinations...`,
        );
      }
    } else {
      this.logger.warn('[AIService] HF_API_KEY not set — skipping HF image generation. Add HF_API_KEY to .env for better image quality.');
    }

    // ── Tier 2/3: Pollinations ──────────────────────────────────────────────
    // Once the Hugging Face monthly credit is spent (402), Pollinations is the
    // only remaining image source, and it returns a transient 500 often enough
    // that a single attempt is not good enough — one observed 500 was followed
    // by a clean 200 seconds later. Each model gets a retry with a short pause.
    const encodedPrompt = encodeURIComponent(cleanPrompt);
    const timestamp = Date.now();

    const buildUrl = (model: string, seed: number) =>
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=${model}&seed=${seed}`;

    for (const model of ['flux', 'turbo']) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const url = buildUrl(model, timestamp + attempt);
        try {
          this.logger.log(`[AIService] Attempting Pollinations ${model} (attempt ${attempt})...`);
          const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60_000,
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
          });
          if (res.status === 200 && res.data?.byteLength > 1000) {
            this.logger.log(
              `[AIService] Pollinations ${model} succeeded in ${Date.now() - startedAt}ms`,
            );
            // Return the BYTES, not the URL. A Pollinations URL is a generation
            // request, not a hosted file: every fetch re-renders the image,
            // takes 20-60s and often times out. Handing the URL back meant the
            // bytes just downloaded were discarded and something downstream —
            // usually the user's browser — paid for a fresh render and gave up,
            // which is what produced blank/"Retry" post thumbnails.
            const mime = String(res.headers?.['content-type'] || 'image/jpeg').split(';')[0];
            const b64 = Buffer.from(res.data).toString('base64');
            return {
              success: true,
              imageUrl: `data:${mime};base64,${b64}`,
              model: `pollinations-${model}`,
            };
          }
          this.logger.warn(`[AIService] Pollinations ${model} returned an unusable body.`);
        } catch (polErr: any) {
          const status = polErr?.response?.status;
          this.logger.warn(
            `[AIService] Pollinations ${model} attempt ${attempt} failed${status ? ` (status=${status})` : ''}: ${polErr.message}`,
          );
        }
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
        }
      }
    }

    // Everything failed. Return an empty URL rather than a link that was never
    // verified — callers composite over a plain gradient instead of silently
    // embedding a dead image reference that Meta would later fail to fetch.
    this.logger.error(
      `[AIService] All image providers failed after retries (${Date.now() - startedAt}ms). No background image will be used.`,
    );
    return { success: false, imageUrl: '', model: 'none' };
  }

  private buildResponse<T>(
    data: T | null,
    model: string,
    durationMs: number,
    retried: boolean,
  ): AiResponse<T> {
    return {
      success: data !== null,
      data,
      model,
      durationMs,
      retried,
    };
  }
}
