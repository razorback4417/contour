import type { TopologyNode } from "../model/types";

export function traceTopologyPath(a: string, b: string, nodes: ReadonlyMap<string, TopologyNode>): string[] {
  const left = ancestorChain(a, nodes);
  const right = ancestorChain(b, nodes);
  const common = left.find((id) => right.includes(id));
  return common ? [...left.slice(0, left.indexOf(common) + 1), ...right.slice(0, right.indexOf(common)).reverse()] : [a, b];
}

export function pathContainsEdge(path: readonly string[], source: string, target: string): boolean {
  for (let index = 0; index < path.length - 1; index += 1) {
    if ((path[index] === source && path[index + 1] === target) || (path[index] === target && path[index + 1] === source)) return true;
  }
  return false;
}

function ancestorChain(id: string, nodes: ReadonlyMap<string, TopologyNode>): string[] {
  const result: string[] = [];
  let current = nodes.get(id);
  while (current) {
    result.push(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return result;
}
