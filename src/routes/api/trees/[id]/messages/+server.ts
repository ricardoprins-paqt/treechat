import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addToolEvent,
	appendNodeContent,
	createNode,
	getAncestorChain,
	getNode,
	getTree,
	setNodeStatus
} from '$lib/server/db';
import { streamChatCompletion, type ChatMessage } from '$lib/server/llm';
import { executeTool, TOOL_DEFINITIONS } from '$lib/server/tools';

const MAX_TOOL_ROUNDS = 4;

/**
 * Sends a new prompt into a tree and streams back the LLM answer as
 * Server-Sent Events. Passing `parentId` as an existing answer node's id is
 * how branching works: the new prompt becomes a sibling branch off that
 * answer, inheriting its full ancestor chain as context.
 *
 * If the model calls a tool (web_search / fetch_page), we run it server-side,
 * append the result as a `tool` message, and re-call the model - looping up
 * to MAX_TOOL_ROUNDS times - before it produces its final text answer.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const tree = getTree(params.id);
	if (!tree) throw error(404, 'Tree not found');

	const body = await request.json().catch(() => ({}));
	const parentId: string | null = body.parentId ?? null;
	const prompt: string = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) throw error(400, 'prompt is required');

	if (parentId) {
		const parent = getNode(parentId);
		if (!parent || parent.tree_id !== tree.id) throw error(400, 'Invalid parentId');
	}

	const promptNode = createNode({
		treeId: tree.id,
		parentId,
		role: 'prompt',
		content: prompt,
		status: 'done'
	});
	const answerNode = createNode({
		treeId: tree.id,
		parentId: promptNode.id,
		role: 'answer',
		content: '',
		status: 'streaming'
	});

	const chain = getAncestorChain(promptNode.id);
	const messages: ChatMessage[] = chain.map((n) => ({
		role: n.role === 'prompt' ? 'user' : 'assistant',
		content: n.content
	}));

	const encoder = new TextEncoder();
	const abortController = new AbortController();

	const stream = new ReadableStream({
		async start(controller) {
			function send(event: string, data: unknown) {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			}

			send('init', { promptNode, answerNode });

			try {
				for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
					let toolCalls: Awaited<ReturnType<typeof runOneRound>> | null = null;
					toolCalls = await runOneRound(messages, answerNode.id, send, abortController.signal);

					if (!toolCalls || toolCalls.length === 0) {
						setNodeStatus(answerNode.id, 'done');
						send('done', { nodeId: answerNode.id });
						return;
					}

					// Record the assistant's tool-call request, then run each tool
					// and feed results back so the model can continue.
					messages.push({ role: 'assistant', content: '', tool_calls: toolCalls });
					for (const call of toolCalls) {
						const toolLabel =
							call.function.name === 'web_search' ? 'web_search' : 'fetch_page';
						const input: string =
							(safeParse(call.function.arguments)?.query as string | undefined) ??
							(safeParse(call.function.arguments)?.url as string | undefined) ??
							'';

						send('tool_call', { nodeId: answerNode.id, tool: toolLabel, input });

						let resultJson: string;
						try {
							resultJson = await executeTool(call.function.name, call.function.arguments);
						} catch (err) {
							resultJson = JSON.stringify({
								error: err instanceof Error ? err.message : String(err)
							});
						}

						const summary = summarizeToolResult(toolLabel, resultJson);
						addToolEvent(answerNode.id, { tool: toolLabel, input, summary });
						send('tool_result', { nodeId: answerNode.id, tool: toolLabel, input, summary });

						messages.push({
							role: 'tool',
							tool_call_id: call.id,
							name: call.function.name,
							content: resultJson
						});
					}
				}

				// Exceeded MAX_TOOL_ROUNDS without a final answer - ask the model to
				// wrap up with what it has rather than looping forever.
				messages.push({
					role: 'user',
					content: 'Please provide your final answer now based on the information gathered.'
				});
				await runOneRound(messages, answerNode.id, send, abortController.signal);
				setNodeStatus(answerNode.id, 'done');
				send('done', { nodeId: answerNode.id });
			} catch (err) {
				setNodeStatus(answerNode.id, 'error');
				send('error', {
					nodeId: answerNode.id,
					message: err instanceof Error ? err.message : String(err)
				});
			} finally {
				controller.close();
			}
		},
		cancel() {
			abortController.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

/**
 * Streams one chat-completion turn, forwarding text deltas as SSE events and
 * persisting them incrementally. Returns any tool calls the model requested,
 * or null if it produced a plain text answer instead.
 */
async function runOneRound(
	messages: ChatMessage[],
	nodeId: string,
	send: (event: string, data: unknown) => void,
	signal: AbortSignal
) {
	for await (const evt of streamChatCompletion(messages, { signal, tools: TOOL_DEFINITIONS })) {
		if (evt.type === 'delta') {
			appendNodeContent(nodeId, evt.text);
			send('delta', { nodeId, delta: evt.text });
		} else {
			return evt.toolCalls;
		}
	}
	return null;
}

function safeParse(json: string): Record<string, unknown> | null {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

function summarizeToolResult(tool: string, resultJson: string): string {
	try {
		const parsed = JSON.parse(resultJson);
		if (tool === 'web_search') {
			const count = Array.isArray(parsed.results) ? parsed.results.length : 0;
			return `${count} result${count === 1 ? '' : 's'} found`;
		}
		return parsed.title ? `Read "${parsed.title}"` : 'Page fetched';
	} catch {
		return 'Done';
	}
}
