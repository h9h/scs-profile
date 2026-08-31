import { beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scopes happy-dom's globals to exactly the test file that calls this at its
// top level — register()/unregister() run around that file's own suite, so
// no other test file's assumptions about the native fetch/Response are
// disturbed. Also scopes React's act() environment flag the same way.
const reactActEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

export function withDom(): void {
  beforeAll(() => {
    GlobalRegistrator.register();
    reactActEnv.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
    delete reactActEnv.IS_REACT_ACT_ENVIRONMENT;
  });
}
