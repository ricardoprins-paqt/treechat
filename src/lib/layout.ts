import type { Node, Edge } from '@xyflow/svelte';

const NODE_WIDTH = 640;

// Used only until a node's real rendered height has been measured (its
// first paint), so the very first layout pass doesn't collapse to zero.
const DEFAULT_PROMPT_HEIGHT = 90;
const DEFAULT_ANSWER_HEIGHT = 140;

const GAP_X = 60;
const GAP_Y = 40;

/**
 * Arranges nodes into a top-down tree, positioning each node directly below
 * its own parent using that parent's actual measured height — never a
 * shared "generation row" height like a rank-based layout (dagre) would
 * use. That's what keeps a short branch's nodes close together instead of
 * being dragged down to align with a taller sibling branch.
 *
 * Horizontal position is derived bottom-up: leaves are placed left-to-right,
 * and each parent is centered above its children.
 */
export function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
	const childrenOf = new Map<string, string[]>();
	for (const edge of edges) {
		const list = childrenOf.get(edge.source) ?? [];
		list.push(edge.target);
		childrenOf.set(edge.source, list);
	}
	const childIdsOf = (id: string) => childrenOf.get(id) ?? [];

	const heights = new Map<string, number>();
	for (const node of nodes) {
		const fallback = node.type === 'answer' ? DEFAULT_ANSWER_HEIGHT : DEFAULT_PROMPT_HEIGHT;
		heights.set(node.id, (node.data?.measuredHeight as number | undefined) ?? fallback);
	}

	const parentIds = new Set(edges.map((e) => e.target));
	const roots = nodes.filter((n) => !parentIds.has(n.id)).map((n) => n.id);

	const xById = new Map<string, number>();
	const yById = new Map<string, number>();
	let cursor = 0;

	function assignX(id: string): number {
		const children = childIdsOf(id);
		if (children.length === 0) {
			const x = cursor * (NODE_WIDTH + GAP_X);
			cursor += 1;
			xById.set(id, x);
			return x;
		}
		const childXs = children.map(assignX);
		const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
		xById.set(id, x);
		return x;
	}

	function assignY(id: string, y: number) {
		yById.set(id, y);
		const height = heights.get(id) ?? DEFAULT_ANSWER_HEIGHT;
		for (const child of childIdsOf(id)) {
			assignY(child, y + height + GAP_Y);
		}
	}

	for (const root of roots) {
		assignX(root);
		assignY(root, 0);
	}

	return nodes.map((node) => ({
		...node,
		position: {
			x: xById.get(node.id) ?? 0,
			y: yById.get(node.id) ?? 0
		}
	}));
}

export { NODE_WIDTH };
