import { browser } from '$app/environment';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/**
 * Renders markdown to sanitized HTML. Only runs in the browser (DOMPurify
 * needs a real DOM); during SSR it falls back to escaped plain text so the
 * markup is safe until hydration takes over.
 */
export function renderMarkdown(source: string): string {
	if (!browser) {
		return escapeHtml(source);
	}
	const rawHtml = marked.parse(source, { async: false }) as string;
	return DOMPurify.sanitize(rawHtml);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
