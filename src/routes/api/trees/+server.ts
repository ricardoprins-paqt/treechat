import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createTree, listTrees } from '$lib/server/db';

export const GET: RequestHandler = async () => {
	return json(listTrees());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New conversation';
	const tree = createTree(title);
	return json(tree, { status: 201 });
};
