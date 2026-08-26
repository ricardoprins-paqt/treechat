import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteTree, getNodesForTree, getTree } from '$lib/server/db';

export const GET: RequestHandler = async ({ params }) => {
	const tree = getTree(params.id);
	if (!tree) throw error(404, 'Tree not found');
	const nodes = getNodesForTree(params.id);
	return json({ tree, nodes });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const tree = getTree(params.id);
	if (!tree) throw error(404, 'Tree not found');
	deleteTree(params.id);
	return json({ ok: true });
};
