export type Role = 'prompt' | 'answer';
export type NodeStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface Tree {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
}

export interface ToolEvent {
	tool: 'web_search' | 'fetch_page';
	/** For web_search: the query. For fetch_page: the URL. */
	input: string;
	/** Short human-readable summary shown inline, e.g. matched result titles/urls. */
	summary?: string;
}

export interface ConversationNode {
	id: string;
	tree_id: string;
	parent_id: string | null;
	role: Role;
	content: string;
	status: NodeStatus;
	tool_events: ToolEvent[];
	created_at: string;
	updated_at: string;
}
