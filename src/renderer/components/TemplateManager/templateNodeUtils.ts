import { TemplateNode } from '../../../shared/types';

export function mapTemplateNodes(nodes: TemplateNode[], id: string, updater: (node: TemplateNode) => TemplateNode): TemplateNode[] {
  return nodes.map(node => {
    if (node.id === id) return updater(node);
    if (node.children?.length) {
      return { ...node, children: mapTemplateNodes(node.children, id, updater) };
    }
    return node;
  });
}

export function removeTemplateNodeById(nodes: TemplateNode[], id: string): TemplateNode[] {
  return nodes
    .filter(node => node.id !== id)
    .map(node => node.children?.length
      ? { ...node, children: removeTemplateNodeById(node.children, id) }
      : node);
}

export function canMoveTemplateNode(nodes: TemplateNode[], id: string, direction: 'up' | 'down'): boolean {
  const index = nodes.findIndex(node => node.id === id);
  if (index >= 0) {
    return direction === 'up' ? index > 0 : index < nodes.length - 1;
  }
  return nodes.some(node => node.children?.length && canMoveTemplateNode(node.children, id, direction));
}

export function moveTemplateNodeById(nodes: TemplateNode[], id: string, direction: 'up' | 'down'): TemplateNode[] {
  const index = nodes.findIndex(node => node.id === id);
  if (index >= 0) {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= nodes.length) return nodes;
    const updated = [...nodes];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    return updated;
  }

  return nodes.map(node => node.children?.length
    ? { ...node, children: moveTemplateNodeById(node.children, id, direction) }
    : node);
}

export function collectTemplateNodeMoveAvailability(nodes: TemplateNode[]): { up: Set<string>; down: Set<string> } {
  const up = new Set<string>();
  const down = new Set<string>();
  const visit = (items: TemplateNode[]) => {
    items.forEach((node, index) => {
      if (index > 0) up.add(node.id);
      if (index < items.length - 1) down.add(node.id);
      if (node.children?.length) visit(node.children);
    });
  };
  visit(nodes);
  return { up, down };
}

export function flattenTemplateNodeRows(nodes: TemplateNode[], depth = 0): Array<{ node: TemplateNode; depth: number }> {
  return nodes.flatMap(node => [
    { node, depth },
    ...(node.children?.length ? flattenTemplateNodeRows(node.children, depth + 1) : []),
  ]);
}

export function flattenVisibleTemplateNodeRows(nodes: TemplateNode[], collapsedIds: Set<string>, depth = 0): Array<{ node: TemplateNode; depth: number }> {
  return nodes.flatMap(node => [
    { node, depth },
    ...(node.children?.length && !collapsedIds.has(node.id) ? flattenVisibleTemplateNodeRows(node.children, collapsedIds, depth + 1) : []),
  ]);
}

export function findTemplateNodeAncestorIds(nodes: TemplateNode[], targetId: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return trail;
    if (node.children?.length) {
      const found = findTemplateNodeAncestorIds(node.children, targetId, [...trail, node.id]);
      if (found) return found;
    }
  }
  return null;
}

export function collectTemplateNodeIdsByLevel(nodes: TemplateNode[], levels: number[]): string[] {
  const allowed = new Set(levels);
  const ids: string[] = [];
  const visit = (items: TemplateNode[]) => {
    items.forEach(node => {
      if (allowed.has(node.level)) ids.push(node.id);
      if (node.children?.length) visit(node.children);
    });
  };
  visit(nodes);
  return ids;
}

export function collectCollapsibleTemplateNodeIds(nodes: TemplateNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (items: TemplateNode[]) => {
    items.forEach(node => {
      if (node.children?.length) {
        ids.add(node.id);
        visit(node.children);
      }
    });
  };
  visit(nodes);
  return ids;
}

export function countSelectedTemplateNodesWithChildren(nodes: TemplateNode[], selectedIds: Set<string>, parentSelected = false): number {
  return nodes.reduce((count, node) => {
    const selected = parentSelected || selectedIds.has(node.id);
    return count + (selected ? 1 : 0) + (node.children?.length ? countSelectedTemplateNodesWithChildren(node.children, selectedIds, selected) : 0);
  }, 0);
}

export function removeTemplateNodesByIds(nodes: TemplateNode[], selectedIds: Set<string>): TemplateNode[] {
  return nodes
    .filter(node => !selectedIds.has(node.id))
    .map(node => node.children?.length ? { ...node, children: removeTemplateNodesByIds(node.children, selectedIds) } : node);
}

export function rebuildTemplateTree(nodes: TemplateNode[]): TemplateNode[] {
  const roots: TemplateNode[] = [];
  const stack: TemplateNode[] = [];
  nodes.forEach(source => {
    const node: TemplateNode = { ...source, children: undefined };
    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  });
  return roots;
}

export function findEmptyNodeTitle(nodes: TemplateNode[]): TemplateNode | undefined {
  for (const node of nodes) {
    if (!node.title.trim()) return node;
    const child = node.children?.length ? findEmptyNodeTitle(node.children) : undefined;
    if (child) return child;
  }
  return undefined;
}

export function flattenTemplateNodesForMatch(nodes: TemplateNode[]): TemplateNode[] {
  return nodes.flatMap(node => [
    node,
    ...(node.children?.length ? flattenTemplateNodesForMatch(node.children) : []),
  ]);
}

export function removeTemplateNodeByIdInList(nodes: TemplateNode[], id: string): TemplateNode[] {
  return nodes.filter(n => n.id !== id).map(n =>
    n.children?.length ? { ...n, children: removeTemplateNodeByIdInList(n.children, id) } : n
  );
}
