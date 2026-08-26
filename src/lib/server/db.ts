import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ConversationNode, NodeStatus, Role, Tree } from '$lib/types';

const DB_PATH = path.join(process.cwd(), 'data', 'ai-nodes.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
	CREATE TABLE IF NOT EXISTS trees (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS nodes (
		id TEXT PRIMARY KEY,
		tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
		parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
		role TEXT NOT NULL CHECK (role IN ('prompt', 'answer')),
		content TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'streaming', 'done', 'error')),
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_nodes_tree_id ON nodes(tree_id);
	CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
`);

export type { Role, NodeStatus, Tree, ConversationNode };

function now(): string {
	return new Date().toISOString();
}

export function listTrees(): Tree[] {
	return db.prepare('SELECT * FROM trees ORDER BY updated_at DESC').all() as Tree[];
}

export function getTree(id: string): Tree | undefined {
	return db.prepare('SELECT * FROM trees WHERE id = ?').get(id) as Tree | undefined;
}

export function createTree(title: string): Tree {
	const tree: Tree = { id: randomUUID(), title, created_at: now(), updated_at: now() };
	db.prepare('INSERT INTO trees (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
		tree.id,
		tree.title,
		tree.created_at,
		tree.updated_at
	);
	return tree;
}

export function deleteTree(id: string): void {
	db.prepare('DELETE FROM trees WHERE id = ?').run(id);
}

export function touchTree(id: string): void {
	db.prepare('UPDATE trees SET updated_at = ? WHERE id = ?').run(now(), id);
}

export function getNodesForTree(treeId: string): ConversationNode[] {
	return db
		.prepare('SELECT * FROM nodes WHERE tree_id = ? ORDER BY created_at ASC')
		.all(treeId) as ConversationNode[];
}

export function getNode(id: string): ConversationNode | undefined {
	return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as ConversationNode | undefined;
}

export function createNode(params: {
	treeId: string;
	parentId: string | null;
	role: Role;
	content?: string;
	status?: NodeStatus;
}): ConversationNode {
	const node: ConversationNode = {
		id: randomUUID(),
		tree_id: params.treeId,
		parent_id: params.parentId,
		role: params.role,
		content: params.content ?? '',
		status: params.status ?? 'done',
		created_at: now(),
		updated_at: now()
	};
	db.prepare(
		`INSERT INTO nodes (id, tree_id, parent_id, role, content, status, created_at, updated_at)
		 VALUES (@id, @tree_id, @parent_id, @role, @content, @status, @created_at, @updated_at)`
	).run(node);
	touchTree(params.treeId);
	return node;
}

export function updateNodeContent(id: string, content: string, status?: NodeStatus): void {
	db.prepare('UPDATE nodes SET content = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?').run(
		content,
		status ?? null,
		now(),
		id
	);
}

export function appendNodeContent(id: string, chunk: string): void {
	db.prepare('UPDATE nodes SET content = content || ?, updated_at = ? WHERE id = ?').run(chunk, now(), id);
}

export function setNodeStatus(id: string, status: NodeStatus): void {
	db.prepare('UPDATE nodes SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
}

/**
 * Walk parent links from the given node up to the root, returning the chain
 * ordered root-first. Used to build LLM context for a branch.
 */
export function getAncestorChain(nodeId: string): ConversationNode[] {
	const chain: ConversationNode[] = [];
	let current = getNode(nodeId);
	while (current) {
		chain.unshift(current);
		current = current.parent_id ? getNode(current.parent_id) : undefined;
	}
	return chain;
}

export default db;
