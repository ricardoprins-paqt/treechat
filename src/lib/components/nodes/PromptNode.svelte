<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { observeHeight } from '$lib/actions/observeHeight';

	let { data }: NodeProps = $props();

	const onResize = $derived(data.onResize as ((height: number) => void) | undefined);
	const onEdit = $derived(data.onEdit as ((prompt: string) => void) | undefined);
	const content = $derived(data.content as string);

	let editing = $state(false);
	let draft = $state('');

	function startEdit() {
		draft = content;
		editing = true;
	}

	function submitEdit() {
		const trimmed = draft.trim();
		if (!trimmed) return;
		onEdit?.(trimmed);
		editing = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submitEdit();
		} else if (event.key === 'Escape') {
			editing = false;
		}
	}

	function focusOnMount(el: HTMLTextAreaElement) {
		el.focus();
	}
</script>

<div
	use:observeHeight={(height) => onResize?.(height)}
	class="w-[40rem] rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-950 shadow-sm dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100"
>
	<Handle type="target" position={Position.Top} />

	<div class="mb-1 flex items-center justify-between">
		<span class="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">
			Prompt
		</span>
		{#if !editing && onEdit}
			<button
				class="nodrag rounded px-1.5 py-0.5 text-xs text-indigo-500 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-900"
				onclick={startEdit}
				title="Edit this prompt (creates a new branch)"
			>
				✎ Edit
			</button>
		{/if}
	</div>

	{#if editing}
		<div class="nodrag nowheel flex flex-col gap-2">
			<textarea
				bind:value={draft}
				onkeydown={handleKeydown}
				rows="3"
				use:focusOnMount
				class="w-full resize-none rounded border border-indigo-300 bg-white p-1.5 text-xs text-indigo-950 outline-none focus:border-indigo-500 dark:border-indigo-700 dark:bg-indigo-900 dark:text-indigo-50"
			></textarea>
			<div class="flex justify-end gap-2">
				<button
					class="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-900"
					onclick={() => (editing = false)}
				>
					Cancel
				</button>
				<button
					class="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
					onclick={submitEdit}
				>
					Save as new branch
				</button>
			</div>
		</div>
	{:else}
		<div class="whitespace-pre-wrap break-words">{content}</div>
	{/if}

	<Handle type="source" position={Position.Bottom} />
</div>
