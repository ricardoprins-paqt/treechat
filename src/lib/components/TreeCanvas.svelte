<script lang="ts">
	import { SvelteFlow, Background, Controls, type Node, type Edge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import PromptNode from './nodes/PromptNode.svelte';
	import AnswerNode from './nodes/AnswerNode.svelte';
	import { layoutNodes } from '$lib/layout';
	import type { ConversationNode, NodeStatus } from '$lib/types';

	let { treeId, initialNodes }: { treeId: string; initialNodes: ConversationNode[] } = $props();

	let conversationNodes = $state<ConversationNode[]>(initialNodes);
	let rootPrompt = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let measuredHeights: Record<string, number> = {};

	// SvelteFlow recommends `$state.raw` + `bind:` for its nodes/edges so it
	// can track them efficiently. Just as important: `syncFlow()` below only
	// replaces the specific node objects that actually changed and reuses
	// stable per-node callbacks, so unaffected nodes keep the exact same
	// object reference across renders. Handing SvelteFlow a brand new object
	// for every node on every streamed token (as a naive derived array would)
	// made it re-measure/re-mount everything, which is what caused the
	// flicker while an answer was streaming.
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);

	const nodeTypes = { prompt: PromptNode, answer: AnswerNode };

	const branchCallbacks = new Map<string, (prompt: string) => void>();
	function getBranchCallback(id: string) {
		let cb = branchCallbacks.get(id);
		if (!cb) {
			cb = (prompt: string) => sendPrompt(id, prompt);
			branchCallbacks.set(id, cb);
		}
		return cb;
	}

	// Editing a prompt creates a sibling prompt (same parent) with the new
	// text instead of touching the original - the old thread stays intact as
	// its own branch alongside the edited one.
	const editCallbacks = new Map<string, (prompt: string) => void>();
	function getEditCallback(id: string) {
		let cb = editCallbacks.get(id);
		if (!cb) {
			cb = (prompt: string) => {
				const node = conversationNodes.find((n) => n.id === id);
				if (!node) return;
				sendPrompt(node.parent_id, prompt);
			};
			editCallbacks.set(id, cb);
		}
		return cb;
	}

	const resizeCallbacks = new Map<string, (height: number) => void>();
	function getResizeCallback(id: string) {
		let cb = resizeCallbacks.get(id);
		if (!cb) {
			cb = (height: number) => reportHeight(id, height);
			resizeCallbacks.set(id, cb);
		}
		return cb;
	}

	function reportHeight(id: string, height: number) {
		if (measuredHeights[id] === height) return;
		measuredHeights = { ...measuredHeights, [id]: height };
		syncFlow();
	}

	function buildDesiredEdges(): Edge[] {
		return conversationNodes
			.filter((n) => n.parent_id)
			.map((n) => ({ id: `${n.parent_id}-${n.id}`, source: n.parent_id as string, target: n.id }));
	}

	function buildDesiredNodes(): Node[] {
		const parentIds = new Set(conversationNodes.map((n) => n.parent_id).filter(Boolean));
		const base: Node[] = conversationNodes.map((n) => ({
			id: n.id,
			type: n.role,
			position: { x: 0, y: 0 },
			draggable: false,
			data:
				n.role === 'answer'
					? {
							content: n.content,
							status: n.status,
							toolEvents: n.tool_events,
							isLeaf: !parentIds.has(n.id),
							onBranch: getBranchCallback(n.id),
							onResize: getResizeCallback(n.id),
							measuredHeight: measuredHeights[n.id]
						}
					: {
							content: n.content,
							onEdit: getEditCallback(n.id),
							onResize: getResizeCallback(n.id),
							measuredHeight: measuredHeights[n.id]
						}
		}));
		return layoutNodes(base, buildDesiredEdges());
	}

	function sameNode(a: Node, b: Node): boolean {
		const ad = a.data as Record<string, unknown>;
		const bd = b.data as Record<string, unknown>;
		return (
			Math.round(a.position.x) === Math.round(b.position.x) &&
			Math.round(a.position.y) === Math.round(b.position.y) &&
			ad.content === bd.content &&
			ad.status === bd.status &&
			ad.isLeaf === bd.isLeaf &&
			(ad.toolEvents as unknown[] | undefined)?.length ===
				(bd.toolEvents as unknown[] | undefined)?.length
		);
	}

	function syncFlow() {
		const desiredNodes = buildDesiredNodes();
		const prevNodeById = new Map(nodes.map((n) => [n.id, n]));
		nodes = desiredNodes.map((next) => {
			const prev = prevNodeById.get(next.id);
			return prev && sameNode(prev, next) ? prev : next;
		});

		const desiredEdges = buildDesiredEdges();
		const prevEdgeById = new Map(edges.map((e) => [e.id, e]));
		edges = desiredEdges.map((e) => prevEdgeById.get(e.id) ?? e);
	}

	function upsertNode(node: ConversationNode) {
		const idx = conversationNodes.findIndex((n) => n.id === node.id);
		if (idx === -1) conversationNodes = [...conversationNodes, node];
		else {
			const copy = conversationNodes.slice();
			copy[idx] = node;
			conversationNodes = copy;
		}
		syncFlow();
	}

	function appendToNode(id: string, delta: string) {
		const idx = conversationNodes.findIndex((n) => n.id === id);
		if (idx === -1) return;
		const copy = conversationNodes.slice();
		copy[idx] = { ...copy[idx], content: copy[idx].content + delta };
		conversationNodes = copy;
		syncFlow();
	}

	function setStatus(id: string, status: NodeStatus) {
		const idx = conversationNodes.findIndex((n) => n.id === id);
		if (idx === -1) return;
		const copy = conversationNodes.slice();
		copy[idx] = { ...copy[idx], status };
		conversationNodes = copy;
		syncFlow();
	}

	function addToolEvent(id: string, event: { tool: string; input: string; summary?: string }) {
		const idx = conversationNodes.findIndex((n) => n.id === id);
		if (idx === -1) return;
		const copy = conversationNodes.slice();
		copy[idx] = { ...copy[idx], tool_events: [...copy[idx].tool_events, event] } as ConversationNode;
		conversationNodes = copy;
		syncFlow();
	}

	// Build the initial nodes/edges for whatever this tree already had.
	syncFlow();

	async function sendPrompt(parentId: string | null, prompt: string) {
		error = null;
		sending = true;
		try {
			const res = await fetch(`/api/trees/${treeId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parentId, prompt })
			});
			if (!res.ok || !res.body) {
				throw new Error(`Request failed (${res.status})`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const events = buffer.split('\n\n');
				buffer = events.pop() ?? '';

				for (const raw of events) {
					if (!raw.trim()) continue;
					let eventName = 'message';
					let data = '';
					for (const line of raw.split('\n')) {
						if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
						else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
					}
					if (!data) continue;
					const parsed = JSON.parse(data);

					if (eventName === 'init') {
						upsertNode(parsed.promptNode);
						upsertNode(parsed.answerNode);
					} else if (eventName === 'delta') {
						appendToNode(parsed.nodeId, parsed.delta);
					} else if (eventName === 'done') {
						setStatus(parsed.nodeId, 'done');
					} else if (eventName === 'tool_result') {
						addToolEvent(parsed.nodeId, {
							tool: parsed.tool,
							input: parsed.input,
							summary: parsed.summary
						});
					} else if (eventName === 'error') {
						setStatus(parsed.nodeId, 'error');
						error = parsed.message;
					}
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			sending = false;
		}
	}

	function submitRoot() {
		const trimmed = rootPrompt.trim();
		if (!trimmed) return;
		rootPrompt = '';
		sendPrompt(null, trimmed);
	}

	function rootKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submitRoot();
		}
	}
</script>

<div class="relative h-full w-full">
	<SvelteFlow bind:nodes bind:edges {nodeTypes} fitView nodesDraggable={false} panOnScroll>
		<Background />
		<Controls />
	</SvelteFlow>

	{#if conversationNodes.length === 0}
		<div class="absolute inset-0 flex items-center justify-center">
			<div class="w-96 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900">
				<p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">Start the conversation</p>
				<textarea
					bind:value={rootPrompt}
					onkeydown={rootKeydown}
					rows="3"
					placeholder="Type your first prompt…"
					class="w-full resize-none rounded border border-gray-300 p-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
				></textarea>
				<button
					onclick={submitRoot}
					disabled={sending}
					class="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
				>
					Send
				</button>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="absolute bottom-4 left-4 max-w-md rounded bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
			{error}
		</div>
	{/if}
</div>
