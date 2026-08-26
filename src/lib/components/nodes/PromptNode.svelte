<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { observeHeight } from '$lib/actions/observeHeight';

	let { data }: NodeProps = $props();

	const onResize = $derived(data.onResize as ((height: number) => void) | undefined);
</script>

<div
	use:observeHeight={(height) => onResize?.(height)}
	class="w-[40rem] rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-950 shadow-sm dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100"
>
	<Handle type="target" position={Position.Top} />
	<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">
		Prompt
	</div>
	<div class="whitespace-pre-wrap break-words">{data.content as string}</div>
	<Handle type="source" position={Position.Bottom} />
</div>
