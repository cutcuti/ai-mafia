import Anthropic from '@anthropic-ai/sdk';
import type { AgentContext, InputRequest, InputResponse, Responder } from '@ai-mafia/engine';
import { chooseTask, speakTask, systemPrompt, userPrompt } from './prompts.js';

/**
 * Claude-backed player. Forced tool use, so every reply is structured
 * (private thought + public action). Agents see names; seat ids are mapped here.
 * Output is still untrusted — the engine validates it and falls back (I5).
 */
export class ClaudeController implements Responder {
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse> {
    if (req.kind === 'speak') {
      const input = await this.call(ctx, speakTask(req.channel), {
        name: 'speak',
        description: 'Say something to the table (or to your mafia teammate at night).',
        input_schema: {
          type: 'object',
          properties: {
            thought: { type: 'string', description: 'Private reasoning. Never shown to other players.' },
            speech: { type: 'string', description: `What you actually say out loud (max ${req.maxChars} characters).` },
          },
          required: ['thought', 'speech'],
        },
      });
      return { kind: 'speak', thought: String(input.thought ?? ''), speech: String(input.speech ?? '') };
    }
    const toName = new Map(ctx.roster.map((r) => [r.seatId, r.name]));
    const toId = new Map(ctx.roster.map((r) => [r.name, r.seatId]));
    const input = await this.call(ctx, chooseTask(req.action), {
      name: req.action,
      description: `Pick a target for: ${req.action}.`,
      input_schema: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'Private reasoning for your choice.' },
          target: { type: 'string', enum: req.options.map((id) => toName.get(id) ?? id) },
        },
        required: ['thought', 'target'],
      },
    });
    return { kind: 'choose', thought: String(input.thought ?? ''), target: toId.get(String(input.target)) ?? '' };
  }

  private async call(ctx: AgentContext, task: string, tool: Anthropic.Tool): Promise<Record<string, unknown>> {
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
