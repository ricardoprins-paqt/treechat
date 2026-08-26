<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { observeHeight } from '$lib/actions/observeHeight';

	let { data }: NodeProps = $props();

	const isLeaf = $derived(Boolean(data.isLeaf));
	const onResize = $derived(data.onResize as ((height: number) => void) | undefined);

	// Leaf answers (nothing branched off them yet) show an always-open reply
	// box so continuing the main line doesn't require an extra click. Other
	// answers start collapsed behind the "Branch" toggle.
	let branching = $state(Boolean(data.isLeaf));
	let draft = $state('');
	let wasLeaf = Boolean(data.isLeaf);

	const status = $derived(data.status as string);
	const content = $derived(data.content as string);
	const onBranch = $derived(data.onBranch as (prompt: string) => void);
	const html = $derived(renderMarkdown(content));
	const toolEvents = $derived(
		(data.toolEvents as Array<{ tool: string; input: string; summary?: string }>) ?? []
	);

	// Once this node gains a child (someone continued/branched from it), fall
	// back to the collapsed "Branch" toggle instead of keeping the box open.
	$effect(() => {
		if (wasLeaf && !isLeaf) branching = false;
		wasLeaf = isLeaf;
	});

	function submitBranch() {
		const trimmed = draft.trim();
		if (!trimmed) return;
		onBranch(trimmed);
		draft = '';
		if (!isLeaf) branching = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submitBranch();
		}
	}
</script>

<div
	use:observeHeight={(height) => onResize?.(height)}
	class="w-[40rem] rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 shadow-sm dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
>
	<Handle type="target" position={Position.Top} />

	<div class="mb-1 flex items-center justify-between">
		<span class="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
			Answer
		</span>
		{#if status === 'streaming'}
			<span class="flex items-center gap-1 text-xs text-emerald-500">
				<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
				thinking…
			</span>
		{:else if status === 'error'}
			<span class="text-xs text-red-500">error</span>
		{/if}
	</div>

	<div class="prose prose-sm dark:prose-invert max-w-none break-words">
		{#if toolEvents.length > 0}
			<div class="not-prose mb-2 flex flex-col gap-1">
				{#each toolEvents as evt, i (i)}
					<div
						class="flex items-center gap-1.5 rounded bg-emerald-100/70 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
					>
						<span>{evt.tool === 'web_search' ? '🔍' : '📄'}</span>
						<span class="font-medium">{evt.tool === 'web_search' ? 'Searched' : 'Read'}:</span>
						<span class="truncate">{evt.input}</span>
						{#if evt.summary}
							<span class="text-emerald-500 dark:text-emerald-500">— {evt.summary}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		<!--
			linkedom (used to render this markdown to identical HTML during SSR)
			encodes quote/apostrophe characters as HTML entities slightly
			differently than a real browser DOM serializer does. The rendered
			output is visually identical, so this mismatch is expected/harmless.
		-->
		<!-- svelte-ignore hydration_html_changed -->
		{@html html}{#if status === 'streaming'}<span class="animate-pulse">▍</span>{/if}
	</div>

	{#if status === 'done' || status === 'error'}
		{#if branching}
			<div class="nodrag nowheel mt-2 flex flex-col gap-2">
				<textarea
					bind:value={draft}
					onkeydown={handleKeydown}
					placeholder={isLeaf
						? 'Continue the conversation…'
						: 'Branch this conversation with a new prompt…'}
					rows="2"
					class="w-full resize-none rounded border border-emerald-300 bg-white p-1.5 text-xs text-emerald-950 outline-none focus:border-emerald-500 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-50"
				></textarea>
				<div class="flex justify-end gap-2">
					{#if !isLeaf}
						<button
							class="rounded px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900"
							onclick={() => (branching = false)}
						>
							Cancel
						</button>
					{/if}
					<button
						class="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
						onclick={submitBranch}
					>
						{isLeaf ? 'Send' : 'Branch'}
					</button>
				</div>
			</div>
		{:else}
			<button
				class="nodrag mt-2 rounded border border-emerald-400 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
				onclick={() => (branching = true)}
			>
				⑂ Branch
			</button>
		{/if}
	{/if}

	<Handle type="source" position={Position.Bottom} />
</div>
