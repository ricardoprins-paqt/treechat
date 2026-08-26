/**
 * Svelte action that reports an element's rendered (border-box) height
 * whenever it changes, so layout code can react to content-driven resizing
 * instead of relying on a fixed guess.
 */
export function observeHeight(node: HTMLElement, callback: (height: number) => void) {
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
			callback(Math.ceil(height));
		}
	});
	observer.observe(node, { box: 'border-box' });

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
