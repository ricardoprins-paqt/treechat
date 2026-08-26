import type { PageServerLoad } from './$types';
import { listTrees } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	return { trees: listTrees() };
};
