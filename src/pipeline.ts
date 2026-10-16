import type { Catalog } from './catalog-core.js';
import { FileRunStore } from './file-run-store.js';
import { PipelineEngine } from './pipeline-engine.js';

export class Pipeline extends PipelineEngine {
  readonly root: string;
  constructor(catalog: Catalog, root: string) {
    const store = new FileRunStore(root);
    super(catalog, store);
    this.root = store.root;
  }
}
