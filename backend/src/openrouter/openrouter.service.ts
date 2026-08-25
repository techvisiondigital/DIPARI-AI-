import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * OpenRouterService — Reusable AI service that routes all LLM requests
 * through OpenRouter (https://openrouter.ai).
 *
 * Model is read from environment variable OPENROUTER_MODEL.
 * Default: google/gemma-4-31b-it:free
 *
 * Environment variables:
 *   OPENROUTER_API_KEY=sk-or-v1-...
 *   OPENROUTER_MODEL=google/gemma-4-31b-it:free
 */
@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    this.model = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';

    if (!this.apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY is not set. AI features will use fallback responses.',
      );
    } else {
      this.logger.log(
        `OpenRouter initialized with model: ${this.model}`,
      );
    }
  }

  /**
   * Send a chat completion request to OpenRouter.
   *
   * @param systemPrompt  System-level instruction for the model
   * @param userPrompt    The user's message / task description
   * @param temperature   Creativity (0.0 – 2.0, default 0.7)
   * @param maxTokens     Maximum output tokens (default 2048)
   * @returns             The model's response text
   */
  async chat(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.7,
    maxTokens = 2048,
  ): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('No OPENROUTER_API_KEY configured — returning empty response');
      return '';
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://campaignai.app',
            'X-Title': 'Visionpilot AI',
          },
        },
      );

      const text = response.data?.choices?.[0]?.message?.content || '';
      return text.trim();
    } catch (error: any) {
      const errMsg = error?.response?.data?.error?.message || error?.message || 'Unknown error';
      this.logger.error(`OpenRouter API error for model ${this.model}: ${errMsg}`);
      
      if (this.model !== 'openrouter/free') {
        this.logger.warn(`Attempting fallback to 'openrouter/free' model...`);
        try {
          const fallbackResponse = await axios.post(
            this.baseUrl,
            {
              model: 'openrouter/free',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              temperature,
              max_tokens: maxTokens,
            },
            {
              headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://campaignai.app',
                'X-Title': 'Visionpilot AI',
              },
            },
          );
          const text = fallbackResponse.data?.choices?.[0]?.message?.content || '';
          this.logger.log(`Fallback to 'openrouter/free' succeeded.`);
          return text.trim();
        } catch (fallbackError: any) {
          const fallbackErrMsg = fallbackError?.response?.data?.error?.message || fallbackError?.message || 'Unknown error';
          this.logger.error(`OpenRouter fallback error: ${fallbackErrMsg}`);
          throw new Error(`OpenRouter request failed: ${errMsg} (Fallback also failed: ${fallbackErrMsg})`);
        }
      }
      
      throw new Error(`OpenRouter request failed: ${errMsg}`);
    }
  }

  /**
   * Send a chat completion and parse the result as JSON.
   * Expects the model to return valid JSON matching the provided type.
   */
  async chatJson<T>(
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.7,
    maxTokens = 2048,
  ): Promise<T | null> {
    const jsonPrompt = `${userPrompt}\n\nReturn ONLY valid JSON. No markdown, no code fences, no explanation.`;
    const text = await this.chat(systemPrompt, jsonPrompt, temperature, maxTokens);

    if (!text) return null;

    try {
      // Try direct parse first
      return JSON.parse(text) as T;
    } catch {
      // Fallback: extract JSON from markdown code fences
      const jsonMatch = text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          this.logger.error('Failed to parse OpenRouter response as JSON');
          return null;
        }
      }
      this.logger.error('No JSON found in OpenRouter response');
      return null;
    }
  }

  /**
   * AI Image Generation using OpenRouter.
   */
  async generateImage(prompt: string): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('No OPENROUTER_API_KEY configured — returning fallback image URL');
      const kw = encodeURIComponent(prompt.split(' ').slice(0, 3).join(','));
      return `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80&kw=${kw}`;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'black-forest-labs/flux-1-schnell',
          messages: [
            {
              role: 'user',
              content: `Generate an image for: ${prompt}`,
            },
          ],
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://campaignai.app',
            'X-Title': 'Visionpilot AI',
          },
          timeout: 15_000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content || '';
      const urlMatch = content.match(/https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp)/i);
      if (urlMatch) return urlMatch[0];
    } catch (e: any) {
      this.logger.warn(`OpenRouter image generation fallback used due to: ${e.message}`);
    }

    const kw = encodeURIComponent(prompt.split(' ').slice(0, 3).join(','));
    return `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80&kw=${kw}`;
  }
}