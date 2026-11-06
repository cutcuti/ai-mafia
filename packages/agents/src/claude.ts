import Anthropic from '@anthropic-ai/sdk';
import { chooseTask, speakTask, systemPrompt, userPrompt } from './prompts.js';
import type { Action, Agent, V0AgentContext, ChooseResult, SpeakResult } from '@ai-mafia/engine';

/**
 * Claude-backed player. Uses forced tool use so every reply is structured
 * (private thought + public action) — no regex parsing of free text.
 */
export class ClaudeAgent implements Agent {
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async speak(ctx: V0AgentContext, channel: 'public' | 'mafia'): Promise<SpeakResult> {
    const input = await this.call(ctx, speakTask(channel), {
      name: 'speak',
      description: 'Say something to the table (or to your mafia teammate at night).',
      input_schema: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Private reasoning. Never shown to other players.' },
          speech: { type: 'string', description: 'What you actually say out loud.' },
        },
        required: ['thought', 'speech'],
      },
    });
    return { thought: String(input.thought ?? ''), speech: String(input.speech ?? '...') };
  }

  async choose(ctx: V0AgentContext, action: Action, options: string[]): Promise<ChooseResult> {
    const input = await this.call(ctx, chooseTask(action), {
      name: action,
      description: `Pick a target for: ${action}.`,
      input_schema: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Private reasoning for your choice.' },
          target: { type: 'string', enum: options },
        },
        required: ['thought', 'target'],
      },
    });
    return { thought: String(input.thought ?? ''), target: String(input.target ?? '') };
  }

  private async call(ctx: V0AgentContext, task: string, tool: Anthropic.Tool): Promise<Record<string, unknown>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 600,
      system: systemPrompt(ctx),
      messages: [{ role: 'user', content: userPrompt(ctx, task) }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') throw new Error('model did not call the tool');
    return block.input as Record<string, unknown>;
  }
}
