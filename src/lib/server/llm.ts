import { env } from '$env/dynamic/private';

const BASE_URL = env.LLM_BASE_URL ?? 'http://10.69.1.213:8000/v1';
const MODEL = env.LLM_MODEL ?? 'deepseek-ai/DeepSeek-V4-Flash-0731';
const API_KEY = env.LLM_API_KEY ?? 'unused';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	/** Set on assistant messages that requested tool calls. */
	tool_calls?: ToolCall[];
	/** Set on tool-result messages, must match the originating tool_call's id. */
	tool_call_id?: string;
	/** Set on tool-result messages alongside tool_call_id. */
	name?: string;
}

export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

/** One chunk of a streamed chat completion: either text or a completed set of tool calls. */
export type StreamEvent =
	| { type: 'delta'; text: string }
	| { type: 'tool_calls'; toolCalls: ToolCall[] };

/**
 * Streams a chat completion from the internal vLLM OpenAI-compatible endpoint.
 * Yields text deltas as they arrive, and a final `tool_calls` event if the
 * model decided to call one or more tools instead of (or in addition to)
 * producing text.
 */
export async function* streamChatCompletion(
	messages: ChatMessage[],
	options?: { signal?: AbortSignal; tools?: ToolDefinition[] }
): AsyncGenerator<StreamEvent, void, unknown> {
	const response = await fetch(`${BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${API_KEY}`
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			stream: true,
			...(options?.tools ? { tools: options.tools, tool_choice: 'auto' } : {})
		}),
		signal: options?.signal
	});

	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => '');
		throw new Error(`LLM request failed (${response.status}): ${text}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	// Tool calls stream in as incremental deltas keyed by index: the name
	// arrives once, then the arguments string arrives in fragments that must
	// be concatenated in order.
	const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			// Keep the last (possibly incomplete) line in the buffer.
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;

				const payload = trimmed.slice('data:'.length).trim();
				if (payload === '[DONE]') {
					if (toolCallsByIndex.size > 0) {
						yield { type: 'tool_calls', toolCalls: finalizeToolCalls(toolCallsByIndex) };
					}
					return;
				}

				try {
					const parsed = JSON.parse(payload);
					const choice = parsed.choices?.[0];
					const delta = choice?.delta;

					const text: string | undefined = delta?.content;
					if (text) yield { type: 'delta', text };

					const deltaToolCalls: Array<{
						index: number;
						id?: string;
						function?: { name?: string; arguments?: string };
					}> = delta?.tool_calls;
					if (deltaToolCalls) {
						for (const tc of deltaToolCalls) {
							const existing = toolCallsByIndex.get(tc.index) ?? {
								id: '',
								name: '',
								arguments: ''
							};
							if (tc.id) existing.id = tc.id;
							if (tc.function?.name) existing.name += tc.function.name;
							if (tc.function?.arguments) existing.arguments += tc.function.arguments;
							toolCallsByIndex.set(tc.index, existing);
						}
					}

					if (choice?.finish_reason === 'tool_calls' && toolCallsByIndex.size > 0) {
						yield { type: 'tool_calls', toolCalls: finalizeToolCalls(toolCallsByIndex) };
						return;
					}
				} catch {
					// Ignore malformed SSE chunks.
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function finalizeToolCalls(
	byIndex: Map<number, { id: string; name: string; arguments: string }>
): ToolCall[] {
	return Array.from(byIndex.entries())
		.sort(([a], [b]) => a - b)
		.map(([, tc]) => ({
			id: tc.id,
			type: 'function' as const,
			function: { name: tc.name, arguments: tc.arguments }
		}));
}
