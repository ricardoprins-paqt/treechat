<script lang="ts">
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import type { Tree } from '$lib/types';

	let { data }: { data: { trees: Tree[] } } = $props();

	let creating = $state(false);
	let newTitle = $state('');

	async function createTree() {
		creating = true;
		try {
			const res = await fetch('/api/trees', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: newTitle.trim() || undefined })
			});
			if (!res.ok) throw new Error('Failed to create conversation');
			const tree: Tree = await res.json();
			newTitle = '';
			await goto(`/trees/${tree.id}`);
		} finally {
			creating = false;
		}
	}

	async function deleteTree(id: string, event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();
		if (!confirm('Delete this conversation and all its branches?')) return;
		await fetch(`/api/trees/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString();
	}
</script>

<svelte:head>
	<title>AI Nodes</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="mb-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">AI Nodes</h1>
	<p class="mb-8 text-sm text-gray-500 dark:text-gray-400">
		Branching conversations with a local LLM. Every prompt and answer is a node — branch off any
		answer to explore a new direction.
	</p>

	<div class="mb-8 flex gap-2">
		<input
			bind:value={newTitle}
			placeholder="New conversation title (optional)"
			class="flex-1 rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
		/>
		<button
			onclick={createTree}
			disabled={creating}
			class="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
		>
			+ New conversation
		</button>
	</div>

	{#if data.trees.length === 0}
		<p class="text-sm text-gray-400">No conversations yet. Create one above to get started.</p>
	{:else}
		<ul class="space-y-2">
			{#each data.trees as tree (tree.id)}
				<li>
					<a
						href={`/trees/${tree.id}`}
						class="flex items-center justify-between rounded border border-gray-200 px-4 py-3 hover:border-indigo-400 hover:bg-indigo-50 dark:border-gray-700 dark:hover:bg-gray-800"
					>
						<div>
							<div class="font-medium text-gray-800 dark:text-gray-100">{tree.title}</div>
							<div class="text-xs text-gray-400">Updated {formatDate(tree.updated_at)}</div>
						</div>
						<button
							onclick={(e) => deleteTree(tree.id, e)}
							class="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
						>
							Delete
						</button>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
