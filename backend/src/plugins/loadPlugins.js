import { pluginRegistry } from './registry.js';
import { gtdPlugin } from './gtd/index.js';
import { notetracePlugin } from './notetrace/index.js';
import { flowPlugin } from './flow/index.js';

// Register the bundled (Tier-1, in-repo) plugins into the registry. Called once at boot,
// before routes are mounted. The order here is the order plugin routers mount in index.js.
export function loadBundledPlugins(registry = pluginRegistry) {
  registry.register(gtdPlugin);
  registry.register(notetracePlugin);
  registry.register(flowPlugin);
  return registry;
}
