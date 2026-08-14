// Reactive model used only by the static Svelte conversation export.
// Session data is immutable after bootstrap; only tree navigation and filters
// change while the snapshot is open.

import { SvelteMap } from 'svelte/reactivity';
import { buildSessionLookups } from './session-data.js';
import {
  buildTree,
  buildTreeNodeMap,
  flattenTree,
  buildActivePathIds,
  findNewestLeaf,
  getPath,
  stitchOrphanRoots,
} from '../tree/session-tree.js';
import { filterNodes } from '../tree/session-filter.js';

function refillMap(target, source) {
  target.clear();
  source.forEach((value, key) => target.set(key, value));
}

export class SessionDataModel {
  entries = $state([]);
  header = $state(null);
  systemPrompt = $state(null);
  tools = $state(null);
  renderedTools = $state(null);
  leafId = $state('');
  urlTargetId = $state(null);

  byId = new SvelteMap();
  toolCallMap = new SvelteMap();
  labelMap = new SvelteMap();

  currentLeafId = $state('');
  currentTargetId = $state('');
  filterMode = $state('default');
  searchQuery = $state('');

  tree = $derived(buildTree(this.entries, this.labelMap));
  nodeMap = $derived(buildTreeNodeMap(this.tree));
  activePathIds = $derived(
    buildActivePathIds(this.currentTargetId || this.currentLeafId, this.byId),
  );
  activePath = $derived(getPath(this.currentLeafId, this.byId));
  flatNodes = $derived(flattenTree(this.tree, this.activePathIds));
  filteredNodes = $derived(
    filterNodes(this.flatNodes, this.currentLeafId, {
      filterMode: this.filterMode,
      searchQuery: this.searchQuery,
    }),
  );

  constructor(data = {}) {
    this.entries = stitchOrphanRoots(Array.isArray(data.entries) ? data.entries : []);
    this.header = data.header ?? null;
    this.systemPrompt = data.systemPrompt ?? null;
    this.tools = data.tools ?? null;
    this.renderedTools = data.renderedTools ?? null;
    this.urlTargetId = data.urlTargetId ?? null;
    this.leafId = data.leafId ?? data.defaultLeafId ?? '';

    const lookups = buildSessionLookups(this.entries);
    refillMap(this.byId, lookups.byId);
    refillMap(this.toolCallMap, lookups.toolCallMap);
    refillMap(this.labelMap, lookups.labelMap);

    this.currentLeafId = this.leafId;
    this.currentTargetId = this.urlTargetId || this.currentLeafId;
  }

  navigateTo(leafId, targetId = leafId) {
    this.currentLeafId = leafId;
    this.currentTargetId = targetId;
  }

  newestLeaf(nodeId) {
    return findNewestLeaf(nodeId, this.nodeMap);
  }
}
