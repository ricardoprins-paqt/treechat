import { env } from '$env/dynamic/private';

const BASE_URL = env.LLM_BASE_URL ?? 'http://10.69.1.213:8000/v1';
const MODEL = env.LLM_MODEL ?? 'deepseek-ai/DeepSeek-V4-Flash-0731';
const API_KEY = env.LLM_API_KEY ?? 'unused';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * Streams a chat completion from the internal vLLM OpenAI-compatible endpoint.
 * Yields incremental text chunks (deltas) as they arrive.
 */
export async function* streamChatCompletion(
	messages: ChatMessage[],
	options?: { signal?: AbortSignal }
): AsyncGenerator<string, void, unknown> {
	const response = await fetch(`${BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${API_KEY}`
		},
		body: JSON.stringify({
			model: MODEL,
			messages,
			stream: true
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
				if (payload === '[DONE]') return;

				try {
					const parsed = JSON.parse(payload);
					const delta: string | undefined = parsed.choices?.[0]?.delta?.content;
					if (delta) yield delta;
				} catch {
					// Ignore malformed SSE chunks.
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
