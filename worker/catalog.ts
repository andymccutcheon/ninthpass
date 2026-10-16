import { Catalog } from '../src/catalog-core.js';
import sources from './skills.generated.json';

export const catalog = Catalog.fromAssets(new Map(Object.entries(sources)));
