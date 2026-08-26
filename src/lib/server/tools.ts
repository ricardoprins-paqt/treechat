import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ToolDefinition } from './llm';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Roughly 4 chars/token; keeps fetched page text well inside the model's context window. */
const MAX_PAGE_CHARS = 20000;

/**
 * DuckDuckGo's HTML search endpoint rejects requests that arrive without a
 * prior session cookie (bot detection). Visiting the homepage once and
 * reusing the `Set-Cookie` it returns satisfies that check. Cached per
 * server process and refreshed if a search ever gets fewer than 0 results.
 */
let ddgCookie: string | null = null;

async function getDuckDuckGoCookie(): Promise<string> {
	if (ddgCookie) return ddgCookie;
	const res = await fetch('https://duckduckgo.com/', { headers: { 'User-Agent': USER_AGENT } });
	const setCookie = res.headers.get('set-cookie') ?? '';
	ddgCookie = setCookie.split(';')[0] ?? '';
	return ddgCookie;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'web_search',
			description:
				'Search the web for current information. Returns a list of results with title, URL, and a short snippet. Use this to find sources, then use fetch_page on a promising URL to read its full content.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'The search query.' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'fetch_page',
			description:
				'Fetch a web page by URL and return its main readable text content (article body, stripped of navigation/ads). Use after web_search to read a specific result in full.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'The URL to fetch.' }
				},
				required: ['url']
			}
		}
	}
];

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/**
 * Searches DuckDuckGo's HTML endpoint (no API key required) and parses the
 * result list out of the returned markup. This is a scrape of an
 * undocumented page, not an official API, so the markup could change or the
 * endpoint could rate-limit under heavy use - acceptable trade-off for a
 * personal app that wants zero signup/API keys.
 */
export async function webSearch(query: string, _isRetry = false): Promise<SearchResult[]> {
	const cookie = await getDuckDuckGoCookie();
	const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
		headers: {
			'User-Agent': USER_AGENT,
			Referer: 'https://duckduckgo.com/',
			...(cookie ? { Cookie: cookie } : {})
		}
	});
	if (!res.ok) throw new Error(`Search request failed (${res.status})`);
	const html = await res.text();
	const { document } = parseHTML(html);

	const results: SearchResult[] = [];
	for (const el of document.querySelectorAll('.result')) {
		const linkEl = el.querySelector('.result__a');
		const snippetEl = el.querySelector('.result__snippet');
		if (!linkEl) continue;

		const href = linkEl.getAttribute('href') ?? '';
		const url = unwrapDuckDuckGoRedirect(href);
		const title = linkEl.textContent?.trim() ?? '';
		const snippet = snippetEl?.textContent?.trim() ?? '';
		if (title && url) results.push({ title, url, snippet });

		if (results.length >= 6) break;
	}

	// Bot-detection page or an expired cookie yields zero results; retry once
	// with a freshly fetched cookie before giving up.
	if (results.length === 0 && !_isRetry) {
		ddgCookie = null;
		return webSearch(query, true);
	}

	return results;
}

/** DuckDuckGo's HTML result links are redirect URLs like `//duckduckgo.com/l/?uddg=<encoded>`. */
function unwrapDuckDuckGoRedirect(href: string): string {
	try {
		const url = new URL(href, 'https://duckduckgo.com');
		const target = url.searchParams.get('uddg');
		return target ? decodeURIComponent(target) : href;
	} catch {
		return href;
	}
}

/**
 * Fetches a page and extracts its main readable content via Readability,
 * truncated to a safe character budget so it can't blow out the model's
 * context window.
 */
export async function fetchPage(url: string): Promise<{ title: string; content: string }> {
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
	const html = await res.text();

	const { document } = parseHTML(html);
	const article = new Readability(document as unknown as Document).parse();

	const title = article?.title ?? document.title ?? url;
	let content = article?.textContent?.trim() ?? '';
	if (!content) {
		content = document.body?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
	}
	if (content.length > MAX_PAGE_CHARS) {
		content = content.slice(0, MAX_PAGE_CHARS) + '\n\n[content truncated]';
	}
	return { title, content };
}

/** Runs a tool call by name and returns its result serialized as a string for a `tool` message. */
export async function executeTool(name: string, argsJson: string): Promise<string> {
	const args = JSON.parse(argsJson || '{}');
	switch (name) {
		case 'web_search': {
			const results = await webSearch(String(args.query ?? ''));
			return JSON.stringify({ results });
		}
		case 'fetch_page': {
			const page = await fetchPage(String(args.url ?? ''));
			return JSON.stringify(page);
		}
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}
