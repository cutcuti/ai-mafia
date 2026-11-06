import { createRng } from '@ai-mafia/engine';
import type { ModelSpec } from './models.config.js';
import { MockProvider } from './providers/mock.js';
import type { CompletionRequest, Provider } from './providers/types.js';

const LINES = ['ngl {x} is acting weird', 'I trust {x} less every round', 'hear me out: {x}', 'not voting {x} would be wild'];

/** Offline stand-in for a real provider: random valid tool input, fake-but-plausible usage. Zero cost, zero network. */
export function dryRunProvider(spec: ModelSpec, seed = 1): Provider {
  const rng = createRng(seed);
  return new MockProvider(
    (req: CompletionRequest) => {
      const props = (req.tool.schema as { properties: Record<string, { enum?: string[] }> }).properties;
      if (req.tool.name === 'write_notes') return { notes: `dry-run notes from ${spec.id}` };
      if (req.tool.name === 'speak') {
        const x = rng.pick(props.accuses?.enum ?? ['someone']);
        return { thought: `[dry-run ${spec.id}] thinking`, speech: rng.pick(LINES).replace('{x}', x), accuses: x };
      }
      return { thought: `[dry-run ${spec.id}] picking`, target: rng.pick(props.target?.enum ?? ['']) };
    },
    { inputTokens: 2000, outputTokens: 60 },
  );
}
