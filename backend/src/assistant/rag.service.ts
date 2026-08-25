import { Injectable, Logger } from '@nestjs/common';
import { CAMPAIGNAI_CHUNKS, KnowledgeChunk, ALLOWED_TOPICS } from './knowledge-base';

export interface RetrievalResult {
  isOutOfScope: boolean;
  isGreeting: boolean;
  chunks: KnowledgeChunk[];
  topScore: number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  // General out-of-scope pattern rules
  private readonly outOfScopePatterns: RegExp[] = [
    /what is (python|java|javascript|c\+\+|react|angular|vue|rust|go|html|css|php)/i,
    /explain (java|python|react|dsa|oop|recursion|binary tree|linked list|sorting)/i,
    /who is (virat kohli|shah rukh|modi|biden|trump|obama|messi|ronaldo|elon musk)/i,
    /who (is|was) the (prime minister|president|king|queen|governor)/i,
    /tell me (a |an )?(joke|story|poem|riddle|fact)/i,
    /write (me )?(a |an )?(poem|song|essay|story|code|script for python|dsa)/i,
    /solve (dsa|leetcode|codeforces|math|equation)/i,
    /weather|temperature|forecast/i,
    /news|politics|sports|cricket|football|movie|film|actor|actress/i,
    /capital of [a-z]+/i,
    /how to (cook|code in python|learn java|play cricket)/i,
  ];

  private readonly greetingPatterns: RegExp[] = [
    /^(hi|hello|hey|greetings|good morning|good afternoon|good evening)\b/i,
    /who are you/i,
    /what can you do/i,
    /what is your name/i,
    /help me/i,
  ];

  /**
   * Performs out-of-scope checking and retrieves top knowledge chunks for a query.
   */
  retrieve(query: string): RetrievalResult {
    const trimmed = query.trim().toLowerCase();

    // 1. Check for explicit greeting
    const isGreeting = this.greetingPatterns.some(pattern => pattern.test(trimmed)) && trimmed.length < 35;
    if (isGreeting && !ALLOWED_TOPICS.some(topic => trimmed.includes(topic))) {
      return {
        isOutOfScope: false,
        isGreeting: true,
        chunks: [],
        topScore: 10,
      };
    }

    // 2. Check explicit out-of-scope patterns
    const matchesOOS = this.outOfScopePatterns.some(pattern => pattern.test(trimmed));
    if (matchesOOS && !this.hasDirectVisionpilotAIMatch(trimmed)) {
      this.logger.log(`Query matched explicit out-of-scope pattern: "${query}"`);
      return {
        isOutOfScope: true,
        isGreeting: false,
        chunks: [],
        topScore: 0,
      };
    }

    // 3. Tokenize query
    const queryTokens = this.tokenize(trimmed);

    // 4. Score each KnowledgeChunk
    const scoredChunks = CAMPAIGNAI_CHUNKS.map(chunk => {
      const score = this.calculateChunkScore(queryTokens, trimmed, chunk);
      return { chunk, score };
    });

    // Sort descending by score
    scoredChunks.sort((a, b) => b.score - a.score);

    const topScore = scoredChunks[0]?.score || 0;
    this.logger.log(`RAG Retrieval top query score for "${query}": ${topScore} (Top chunk: ${scoredChunks[0]?.chunk?.id || 'none'})`);

    // Threshold cutoff (min score required to consider context relevant)
    const RELEVANCE_THRESHOLD = 0.5;

    if (topScore < RELEVANCE_THRESHOLD && !this.hasDirectVisionpilotAIMatch(trimmed)) {
      return {
        isOutOfScope: true,
        isGreeting: false,
        chunks: [],
        topScore,
      };
    }

    // Return top 3 matching chunks
    const topChunks = scoredChunks
      .filter(item => item.score >= RELEVANCE_THRESHOLD)
      .slice(0, 3)
      .map(item => item.chunk);

    return {
      isOutOfScope: false,
      isGreeting: false,
      chunks: topChunks.length > 0 ? topChunks : [CAMPAIGNAI_CHUNKS[0]],
      topScore,
    };
  }

  /**
   * Polite refusal message for out-of-scope or unretrieved queries.
   */
  getOutOfScopeResponse(): string {
    return "I'm sorry, but I'm the Visionpilot AI Help Assistant (Meta authorised AI marketing agent) and I can only assist with questions related to Visionpilot AI and its features.\n\nIf you have any questions about using Visionpilot AI, connecting Meta, creating campaigns, managing leads, analytics, content scheduling, or any other platform functionality, I'll be happy to help.";
  }

  /**
   * Greeting message welcoming user to Visionpilot AI support.
   */
  getGreetingResponse(): string {
    return "Hello! 👋 I am the official Visionpilot AI Help Assistant (Meta authorised AI marketing agent).\n\nI'm here to help you understand and navigate Visionpilot AI. Ask me anything about:\n\n• 👤 Account & Authentication\n• 📱 Meta Connection (Facebook/Instagram)\n• 🚀 Campaign Creation & AI Generator\n• 📅 Content Calendar & Auto Scheduler\n• 👥 Lead CRM & AI Lead Assistant\n• 📊 Analytics & Reports\n• ⚙️ Settings & Subscription Plans\n\nHow can I help you today?";
  }

  private hasDirectVisionpilotAIMatch(trimmed: string): boolean {
    const directKeywords = [
      'visionpilot', 'visionpilotai', 'dipari', 'campaignai', 'campaign', 'meta', 'facebook', 'instagram',
      'lead', 'analytic', 'analytics', 'anaytics', 'scheduler', 'schedule',
      'onboarding', 'roas', 'platform', 'feature', 'help', 'app', 'tool',
      'website', 'seo', 'post', 'ad', 'subscription', 'plan', 'billing', 'price', 'cost'
    ];
    return directKeywords.some(kw => trimmed.includes(kw));
  }

  private calculateChunkScore(queryTokens: string[], fullQuery: string, chunk: KnowledgeChunk): number {
    let score = 0;

    // 1. Keyword match (high weight)
    for (const keyword of chunk.keywords) {
      if (fullQuery.includes(keyword.toLowerCase())) {
        score += 6;
      }
    }

    // 2. Title term match
    const titleTokens = this.tokenize(chunk.title.toLowerCase());
    for (const token of queryTokens) {
      if (token.length > 2 && titleTokens.includes(token)) {
        score += 4;
      }
    }

    // 3. Module match
    const moduleTokens = this.tokenize(chunk.module.toLowerCase());
    for (const token of queryTokens) {
      if (token.length > 2 && moduleTokens.includes(token)) {
        score += 3;
      }
    }

    // 4. Content term match
    const contentTokens = this.tokenize(chunk.content.toLowerCase());
    for (const token of queryTokens) {
      if (token.length > 3 && contentTokens.includes(token)) {
        score += 1;
      }
    }

    return score;
  }

  private tokenize(text: string): string[] {
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'to', 'for', 'of', 'with', 'my', 'your', 'how', 'do', 'i', 'can', 'what', 'where']);
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 1 && !stopWords.has(word));
  }
}
