import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { AiService } from '../ai/ai.service';
import { RagService } from './rag.service';
import { KnowledgeChunk } from './knowledge-base';
import { PromptBuilderService } from '../prompt-builder/prompt-builder.service';

/**
 * AssistantService — Visionpilot AI Help Bot.
 *
 * RAG-based support assistant dedicated exclusively to Visionpilot AI (Meta authorised AI marketing agent).
 * Consumes business context via PromptBuilderService.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly aiService: AiService,
    private readonly ragService: RagService,
    private readonly promptBuilder: PromptBuilderService,
  ) {}

  async sendMessage(
    userId: string,
    businessId: string,
    message: string,
    conversationId?: string,
  ) {
    let conversation: any;

    if (conversationId) {
      conversation = await this.firebase.getAIConversationById(conversationId);
      if (!conversation) {
        throw new NotFoundException('Conversation session not found');
      }
    } else {
      // Create new conversation
      conversation = await this.firebase.createAIConversation({
        userId,
        businessId,
        title: message.substring(0, 30) + '...',
        messages: JSON.stringify([]),
      });
    }

    // Parse previous conversation history
    const messagesList = JSON.parse((conversation.messages as string) || '[]');

    // Append user message
    messagesList.push({ role: 'user', content: message });

    // 1. Perform RAG retrieval & out-of-scope check
    const ragResult = this.ragService.retrieve(message);

    let aiResponse: string;

    if (ragResult.isGreeting) {
      aiResponse = this.ragService.getGreetingResponse();
    } else if (ragResult.isOutOfScope) {
      aiResponse = this.ragService.getOutOfScopeResponse();
    } else {
      // Fetch business context via PromptBuilderService
      let businessPrompt = '';
      try {
        if (businessId) {
          businessPrompt = await this.promptBuilder.buildBusinessPrompt(businessId);
        }
      } catch { /* fallback if no business profile yet */ }

      // In-scope: generate answer using retrieved context & business context
      aiResponse = await this.generateRagResponse(message, messagesList, ragResult.chunks, businessPrompt);
    }

    // Append AI reply
    messagesList.push({ role: 'model', content: aiResponse });

    // Save back to DB
    const updated = await this.firebase.updateAIConversation(conversation.id, {
      messages: JSON.stringify(messagesList),
    });

    return {
      conversationId: updated.id,
      reply: aiResponse,
      messages: messagesList,
    };
  }

  async getConversations(userId: string, businessId: string) {
    return this.firebase.getAIConversationsByUserAndBusiness(userId, businessId);
  }

  async getConversationDetails(conversationId: string) {
    const convo = await this.firebase.getAIConversationById(conversationId);
    if (!convo) {
      throw new NotFoundException('Conversation not found');
    }
    return {
      ...convo,
      messages: JSON.parse((convo.messages as string) || '[]'),
    };
  }

  /**
   * Generate RAG response via OpenRouter with strict prompt constraints,
   * incorporating business context via PromptBuilderService.
   */
  private async generateRagResponse(
    userPrompt: string,
    history: any[],
    chunks: KnowledgeChunk[],
    businessPromptContext = '',
  ): Promise<string> {
    const formattedContext = chunks
      .map(c => `### ${c.title} (Module: ${c.module}, Page: ${c.pageUrl})\n${c.content}\n${c.steps ? 'Steps:\n' + c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''}\n${c.nextSteps ? 'Next Step: ' + c.nextSteps : ''}`)
      .join('\n\n');

    const systemPrompt = `You are the official Visionpilot AI Help Assistant — dedicated to supporting users with Visionpilot AI (Meta authorised AI marketing agent).

${businessPromptContext ? businessPromptContext + '\n\n' : ''}CRITICAL RULES:
1. You MUST generate responses ONLY using the retrieved Visionpilot AI knowledge context below.
2. DO NOT use external knowledge or general knowledge (no programming, pop culture, sports, general AI explanations, etc.).
3. If the user's question cannot be answered using the provided context, respond politely:
"I'm sorry, but I'm the Visionpilot AI Help Assistant (Meta authorised AI marketing agent) and I can only assist with questions related to Visionpilot AI and its features. If you have any questions about using Visionpilot AI, connecting Meta, creating campaigns, managing leads, analytics, content scheduling, or any other platform functionality, I'll be happy to help."
4. PERSONALITY: Professional, friendly, helpful, patient, respectful, concise, and easy to understand.
5. NEVER say "I can't". Instead say "I'm sorry, but I'm designed specifically to assist with Visionpilot AI."
6. RESPONSE STRUCTURE:
   - Provide clear, step-by-step guidance.
   - Mention the relevant page or module name (e.g. Settings → Meta Integration, Lead CRM, Dashboard, Content Calendar).
   - Suggest the logical next step.
7. FORMATTING CONSTRAINT: Do NOT use markdown double stars (**) or markdown header hashes (###). Provide clean, refined, easy-to-read text with numbered steps or bullet points.

RETRIEVED VISIONPILOT AI KNOWLEDGE CONTEXT:
${formattedContext}`;

    const contextMessages = history.slice(-6).map((m: any) =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n');

    const fullPrompt = `Previous conversation:\n${contextMessages}\n\nUser Question: ${userPrompt}\n\nProvide a refined, step-by-step response based strictly on the retrieved context above. Do not use double stars (**) or hash headers (###).`;

    try {
      const response = await this.aiService.chat(systemPrompt, fullPrompt, 0.4, 512, 'AssistantService.generateRagResponse');
      if (response && response.trim()) {
        let cleanResponse = response.trim();
        cleanResponse = cleanResponse.replace(/^(User Safety|Safety Rating|Thinking|Reasoning):.*?\n+/gi, '').trim();
        // Remove raw markdown double stars and header hashes for clean display
        cleanResponse = cleanResponse.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').trim();
        if (cleanResponse) {
          return cleanResponse;
        }
      }
    } catch (err) {
      this.logger.warn('AI service unavailable for Help Bot RAG, using structured chunk fallback: ' + (err as any)?.message);
    }

    // Deterministic fallback response directly from top retrieved chunk
    return this.buildChunkFallback(chunks[0]);
  }

  /**
   * Builds a clean, structured fallback response directly from a retrieved KnowledgeChunk.
   */
  private buildChunkFallback(chunk?: KnowledgeChunk): string {
    if (!chunk) {
      return this.ragService.getOutOfScopeResponse();
    }

    let reply = `${chunk.title} (${chunk.module} — ${chunk.pageUrl})\n\n${chunk.content}\n\n`;

    if (chunk.steps && chunk.steps.length > 0) {
      reply += `Steps to follow:\n`;
      chunk.steps.forEach((step, idx) => {
        reply += `${idx + 1}. ${step}\n`;
      });
      reply += `\n`;
    }

    if (chunk.nextSteps) {
      reply += `Suggested Next Step: ${chunk.nextSteps}`;
    }

    return reply.replace(/\*\*(.*?)\*\*/g, '$1').trim();
  }
}
