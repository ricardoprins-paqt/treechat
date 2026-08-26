export type Role = 'prompt' | 'answer';
export type NodeStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface Tree {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
}

export interface ConversationNode {
	id: string;
	tree_id: string;
	parent_id: string | null;
	role: Role;
	content: string;
	status: NodeStatus;
	created_at: string;
	updated_at: string;
}
