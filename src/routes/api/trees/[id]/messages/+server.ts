import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	appendNodeContent,
	createNode,
	getAncestorChain,
	getNode,
	getTree,
	setNodeStatus
} from '$lib/server/db';
import { streamChatCompletion, type ChatMessage } from '$lib/server/llm';

/**
 * Sends a new prompt into a tree and streams back the LLM answer as
 * Server-Sent Events. Passing `parentId` as an existing answer node's id is
 * how branching works: the new prompt becomes a sibling branch off that
 * answer, inheriting its full ancestor chain as context.
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
				for await (const delta of streamChatCompletion(messages, { signal: abortController.signal })) {
					appendNodeContent(answerNode.id, delta);
					send('delta', { nodeId: answerNode.id, delta });
				}
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
