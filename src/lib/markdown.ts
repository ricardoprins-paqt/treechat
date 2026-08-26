import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/**
 * DOMPurify needs a real DOM. In the browser we sanitize against the global
 * `window`. During SSR there's no DOM yet, so we spin up a lightweight one
 * via linkedom and bind DOMPurify to that instead.
 *
 * We used to skip DOMPurify during SSR entirely and render escaped plain
 * text there, relying on a post-hydration flag to force a "real" client
 * re-render. That doesn't work: Svelte 5's `{@html ...}` block detects the
 * server/client mismatch, logs `hydration_html_changed`, and *permanently*
 * keeps the server-rendered markup rather than "repairing" it (by design,
 * per Svelte's own source comments — it's considered too costly/error-prone
 * to reconcile raw HTML after hydration). So any difference between the SSR
 * output and the first client render sticks forever, which is exactly the
 * raw-markdown-after-hard-refresh bug. The fix is to make the server render
 * the *same* sanitized HTML the client would, eliminating the mismatch.
 *
 * `import.meta.env.SSR` (rather than `$app/environment`'s `browser`, which
 * is a runtime check) is used here so bundlers can statically eliminate the
 * `linkedom` import from the client bundle.
 */
const purifier: typeof DOMPurify = import.meta.env.SSR
	? DOMPurify(
			(await import('linkedom')).parseHTML('<!doctype html><html><body></body></html>')
				.window as unknown as Window & typeof globalThis
		)
	: DOMPurify;

/** Renders markdown to sanitized HTML, identically on the server and client. */
export function renderMarkdown(source: string): string {
	const rawHtml = marked.parse(source, { async: false }) as string;
	return purifier.sanitize(rawHtml);
}
