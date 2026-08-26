import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getNodesForTree, getTree } from '$lib/server/db';

export const load: PageServerLoad = async ({ params }) => {
	const tree = getTree(params.id);
	if (!tree) throw error(404, 'Conversation not found');
	return { tree, nodes: getNodesForTree(params.id) };
};
