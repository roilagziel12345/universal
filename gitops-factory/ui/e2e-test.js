// End-to-end test for multi-app-manager.html: loads the real HTML/JS into a
// jsdom window, wraps a REAL directory on disk (a copy of output-live-demo)
// behind a minimal File System Access API-compatible adapter, and drives
// the actual app code (button clicks, form fills) exactly like a browser
// would. This is throwaway verification tooling, not committed — the
// permanent regression test is core-logic.test.js.
//
// Run: node ui/e2e-test.js <path-to-app-dir-copy>

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const assert = require("assert");

const appDirPath = process.argv[2];
if (!appDirPath) {
  console.error("Usage: node e2e-test.js <path-to-app-dir>");
  process.exit(1);
}

// --- Minimal File System Access API adapter backed by real fs ---
class NodeFileHandle {
  constructor(fullPath) {
    this.kind = "file";
    this.fullPath = fullPath;
  }
  async getFile() {
    const fullPath = this.fullPath;
    return { text: async () => fs.promises.readFile(fullPath, "utf8") };
  }
  async createWritable() {
    const fullPath = this.fullPath;
    let buffer = "";
    return {
      write: async (text) => { buffer += text; },
      close: async () => { await fs.promises.writeFile(fullPath, buffer, "utf8"); },
    };
  }
}

class NodeDirHandle {
  constructor(fullPath, name) {
    this.kind = "directory";
    this.fullPath = fullPath;
    this.name = name || path.basename(fullPath);
  }
  async *entries() {
    let names;
    try {
      names = await fs.promises.readdir(this.fullPath);
    } catch (e) {
      return;
    }
    for (const name of names) {
      const full = path.join(this.fullPath, name);
      const st = await fs.promises.stat(full);
      yield [name, st.isDirectory() ? new NodeDirHandle(full, name) : new NodeFileHandle(full)];
    }
  }
  async getFileHandle(name, opts) {
    const full = path.join(this.fullPath, name);
    if (!fs.existsSync(full)) {
      if (opts && opts.create) {
        await fs.promises.writeFile(full, "", "utf8");
      } else {
        throw new Error("NotFoundError");
      }
    }
    return new NodeFileHandle(full);
  }
  async getDirectoryHandle(name, opts) {
    const full = path.join(this.fullPath, name);
    if (!fs.existsSync(full)) {
      if (opts && opts.create) {
        await fs.promises.mkdir(full, { recursive: true });
      } else {
        throw new Error("NotFoundError");
      }
    }
    return new NodeDirHandle(full, name);
  }
}

(async () => {
  const html = fs.readFileSync(path.join(__dirname, "multi-app-manager.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
  const { window } = dom;

  // Let the inline <script> tags execute (jsdom runs them synchronously on
  // parse when runScripts:"dangerously" is set + resources:"usable").
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") resolve();
    else window.addEventListener("load", resolve);
  });

  assert.ok(window.jsyaml, "jsyaml should be loaded on window");

  // Function DECLARATIONS at top level of a classic <script> DO become
  // window properties (like var); top-level `const state` does NOT — that's
  // why the app explicitly does `window.__state = state` for testability.
  const win = window;
  assert.strictEqual(typeof win.readAppTree, "function", "readAppTree should be a global function");
  assert.strictEqual(typeof win.deepMerge, "function", "deepMerge should be a global function");
  assert.ok(win.__state, "window.__state should be exposed for testing");

  const dirHandle = new NodeDirHandle(appDirPath);
  const app = await win.readAppTree(dirHandle);

  assert.ok(app.namespaces["demo-web"], "demo-web namespace should be read");
  assert.ok(app.namespaces["demo-web"].microservices["demo-web-frontend"], "demo-web-frontend should be read");
  console.log("readAppTree: OK —", Object.keys(app.namespaces).length, "namespaces,",
    Object.values(app.namespaces).reduce((n, ns) => n + Object.keys(ns.microservices).length, 0), "microservices");

  win.__state.apps.push(app);
  win.__state.activeAppIndex = 0;
  win.__state.activeNamespace = "demo-web";
  win.__state.activeMicroservice = "demo-web-frontend";
  win.__state.activeView = "effective";
  win.renderAll();

  const mergedText = win.document.querySelector("pre.yaml").textContent;
  const merged = win.jsyaml.load(mergedText);
  assert.strictEqual(merged.image.repository, "nginx");
  assert.strictEqual(merged.image.tag, "1.27-alpine");
  assert.strictEqual(merged.route.enabled, true);
  console.log("show effective (via real DOM render): OK — image", merged.image.repository + ":" + merged.image.tag);

  // Switch to the form editor for the EXISTING microservice and confirm
  // fields are pre-populated from the merged (defaults+values+minimal) view
  // — this is what would have crashed before the rowList fix, since
  // demo-web-frontend has existing ports.
  win.__state.activeView = "form";
  win.renderAll();
  const repoInput = win.document.querySelector("fieldset input[placeholder='my-registry/checkout']");
  assert.strictEqual(repoInput.value, "nginx", "form should prefill image repository");
  const portRows = win.document.querySelectorAll(".rows-wrap .list-row");
  assert.ok(portRows.length >= 1, "form should prefill at least one port row from existing ports");
  console.log("form editor prefill for EXISTING microservice: OK —", portRows.length, "row(s) rendered without throwing");

  // Now drive "+ New microservice" end to end and confirm files get written
  // with defaults correctly trimmed.
  win.__state.activeNamespace = "demo-web";
  win.__state.activeMicroservice = { __new: true };
  win.__state.activeView = "form";
  win.renderAll();

  const nameInput = win.document.querySelectorAll("fieldset")[0].querySelectorAll("input")[0];
  nameInput.value = "e2e-test-service";
  const newRepoInput = win.document.querySelector("fieldset input[placeholder='my-registry/checkout']");
  newRepoInput.value = "nginx";
  const newTagInput = win.document.querySelector("fieldset input[placeholder='1.0.0']");
  newTagInput.value = "1.0.0";
  const routeHostInput = win.document.querySelector("input[placeholder='checkout.apps.example.com']");
  routeHostInput.value = "e2e-test.apps.example.com";

  const createBtn = Array.from(win.document.querySelectorAll("button")).find((b) => b.textContent === "Create microservice");
  assert.ok(createBtn, "Create microservice button should exist");
  await createBtn.onclick();

  const writtenValues = fs.readFileSync(path.join(appDirPath, "demo-web", "values", "e2e-test-service-values.yaml"), "utf8");
  const writtenMinimal = fs.readFileSync(path.join(appDirPath, "demo-web", "values-minimal", "e2e-test-service-values-minimal.yaml"), "utf8");
  const writtenRelease = fs.readFileSync(path.join(appDirPath, "demo-web", "releases", "e2e-test-service.yaml"), "utf8");
  const parsedValues = win.jsyaml.load(writtenValues);
  const parsedMinimal = win.jsyaml.load(writtenMinimal);

  assert.strictEqual(parsedValues.image.repository, "nginx");
  assert.strictEqual(parsedValues.route.host, "e2e-test.apps.example.com");
  // route.enabled should be OMITTED (demo-web's namespace defaults already covers it) —
  // this is the core "no duplication" guarantee.
  assert.strictEqual(parsedValues.route.enabled, undefined, "route.enabled should be omitted — already in namespace defaults");
  assert.strictEqual(parsedMinimal.image.tag, "1.0.0");
  assert.strictEqual(win.jsyaml.load(writtenRelease).release, "e2e-test-service");
  console.log("new microservice create + write-to-disk: OK — route.enabled correctly omitted (covered by defaults.yaml)");

  console.log("\nAll e2e checks passed.");
})().catch((e) => {
  console.error("E2E TEST FAILED:", e);
  process.exit(1);
});
