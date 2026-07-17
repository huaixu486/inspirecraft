import type { TemplateNode, WritingTemplate } from '../../shared/types';

function flattenNodes(nodes: TemplateNode[] = []): TemplateNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.children || [])]);
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/[\s*_`]/g, '')
    .replace(/[：:]+$/, '')
    .trim()
    .toLocaleLowerCase();
}

function findHeadingNode(line: string, nodes: TemplateNode[]): TemplateNode | undefined {
  const normalizedLine = normalizeHeading(line);
  return nodes
    .map(node => ({ node, title: normalizeHeading(node.title) }))
    .filter(item => item.title && (
      normalizedLine === item.title
      || normalizedLine.startsWith(`${item.title}（`)
      || normalizedLine.startsWith(`${item.title}(`)
    ))
    .sort((left, right) => right.title.length - left.title.length)[0]?.node;
}

/** Convert a full AI draft with template headings into the node-id map used by Word export. */
export function mapDraftToTemplateSections(template: WritingTemplate, draft: string): Record<string, string> {
  const nodes = flattenNodes(template.nodes || []);
  if (!draft.trim() || nodes.length === 0) return draft.trim() ? { main: draft.trim() } : {};

  const contents: Record<string, string[]> = {};
  const preamble: string[] = [];
  let currentNodeId = '';
  let matchedHeading = false;

  for (const rawLine of draft.replace(/\r\n?/g, '\n').split('\n')) {
    const headingNode = findHeadingNode(rawLine, nodes);
    if (headingNode) {
      currentNodeId = headingNode.id;
      contents[currentNodeId] ||= [];
      matchedHeading = true;
      continue;
    }
    if (currentNodeId) contents[currentNodeId].push(rawLine);
    else if (rawLine.trim()) preamble.push(rawLine);
  }

  if (!matchedHeading) return { main: draft.trim() };
  const firstMatchedId = nodes.find(node => contents[node.id])?.id;
  if (firstMatchedId && preamble.length) contents[firstMatchedId].unshift(...preamble, '');

  return Object.fromEntries(
    Object.entries(contents)
      .map(([id, lines]) => [id, lines.join('\n').trim()])
      .filter(([, content]) => Boolean(content)),
  );
}
