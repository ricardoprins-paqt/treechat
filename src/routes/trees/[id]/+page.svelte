<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import TreeCanvas from '$lib/components/TreeCanvas.svelte';
	import type { ConversationNode, Tree } from '$lib/types';

	let { data }: { data: { tree: Tree; nodes: ConversationNode[] } } = $props();
</script>

<svelte:head>
	<title>{data.tree.title} · AI Nodes</title>
</svelte:head>

<div class="flex h-screen flex-col">
	<header class="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
		<a href="/" class="text-sm text-gray-500 hover:text-indigo-600">&larr; All conversations</a>
		<h1 class="text-sm font-medium text-gray-800 dark:text-gray-100">{data.tree.title}</h1>
	</header>
	<div class="flex-1">
		<SvelteFlowProvider>
			<TreeCanvas treeId={data.tree.id} initialNodes={data.nodes} />
		</SvelteFlowProvider>
	</div>
</div>
