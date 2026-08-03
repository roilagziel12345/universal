const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { TextEncoder, TextDecoder } = require('util');

let dom, window, document;

function loadUI() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
  dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost'
  });
  window = dom.window;
  document = window.document;
  // Polyfill TextEncoder/TextDecoder for zip functions
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  el.value = value;
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  el.checked = checked;
}

function generate() {
  try { ev('generate()'); } catch (e) { /* jsdom DOM quirks */ }
  const el = document.getElementById('yaml-output');
  return el ? el.textContent : '';
}

// Access script-scoped variables via eval
function ev(expr) { return window.eval(expr); }
function getApp() { return ev('apps[activeAppIdx]'); }

// ═══════════════════════════════════════════════════════════

beforeEach(() => { loadUI(); });
afterEach(() => { dom.window.close(); });

// ─── Data model ─────────────────────────────────────────
describe('Environment data model', () => {
  test('app starts with empty environments array', () => {
    const app = getApp();
    expect(app.environments).toEqual([]);
    expect(app.activeEnvIdx).toBe(-1);
  });

  test('ENV_SECTIONS contains all expected sections', () => {
    const sections = ev('ENV_SECTIONS');
    expect(sections).toBeDefined();
    expect(sections.image).toBeDefined();
    expect(sections.image.label).toBe('Image');
    expect(sections.image.fields).toContain('imageRepo');
    expect(sections.image.fields).toContain('imageTag');
    expect(sections.resources).toBeDefined();
    expect(sections.resources.fields).toContain('reqCpu');
    expect(sections.env).toBeDefined();
    expect(sections.env.arrays).toContain('envVars');
    expect(sections.sidecars).toBeDefined();
    expect(sections.sidecars.arrays).toContain('sidecars');
  });

  test('ENV_SECTIONS excludes netflow (visual only)', () => {
    expect(ev('ENV_SECTIONS').netflow).toBeUndefined();
  });

  test('SECTION_YAML_KEYS maps sections to YAML top-level keys', () => {
    const keys = ev('SECTION_YAML_KEYS');
    expect(keys).toBeDefined();
    expect(keys.image).toContain('image');
    expect(keys.resources).toContain('resources');
    expect(keys.probes).toContain('livenessProbe');
    expect(keys.probes).toContain('readinessProbe');
    expect(keys.probes).toContain('startupProbe');
  });
});

// ─── Full coverage: every field and array is mapped ──────
describe('ENV_SECTIONS covers all fields and arrays', () => {
  test('every field in getDefaultFieldValues is mapped to exactly one section', () => {
    const allFieldIds = Object.keys(ev('getDefaultFieldValues()'));
    const sections = ev('ENV_SECTIONS');
    const mappedFields = new Set();

    Object.values(sections).forEach(sec => {
      if (sec.fields) sec.fields.forEach(f => mappedFields.add(f));
    });

    const unmapped = allFieldIds.filter(id => !mappedFields.has(id));
    expect(unmapped).toEqual([]);
  });

  test('no field is mapped to more than one section', () => {
    const sections = ev('ENV_SECTIONS');
    const fieldToSection = {};
    const duplicates = [];

    Object.entries(sections).forEach(([secName, sec]) => {
      if (sec.fields) sec.fields.forEach(f => {
        if (fieldToSection[f]) duplicates.push(`${f} in both ${fieldToSection[f]} and ${secName}`);
        fieldToSection[f] = secName;
      });
    });

    expect(duplicates).toEqual([]);
  });

  test('every array in createDefaultAppState is mapped to exactly one section', () => {
    const appState = ev('createDefaultAppState("test")');
    const sections = ev('ENV_SECTIONS');

    // Collect all array property names from app state (exclude non-array props)
    const arrayProps = Object.keys(appState).filter(k =>
      Array.isArray(appState[k]) && !['environments'].includes(k)
    );

    const mappedArrays = new Set();
    Object.values(sections).forEach(sec => {
      if (sec.arrays) sec.arrays.forEach(a => mappedArrays.add(a));
    });

    const unmapped = arrayProps.filter(a => !mappedArrays.has(a));
    expect(unmapped).toEqual([]);
  });

  test('every mapped array name exists in createDefaultAppState', () => {
    const appState = ev('createDefaultAppState("test")');
    const sections = ev('ENV_SECTIONS');
    const bogus = [];

    Object.entries(sections).forEach(([secName, sec]) => {
      if (sec.arrays) sec.arrays.forEach(a => {
        if (!(a in appState)) bogus.push(`${a} in section ${secName} not in app state`);
      });
    });

    expect(bogus).toEqual([]);
  });

  test('every mapped field name exists in getDefaultFieldValues', () => {
    const defaults = ev('getDefaultFieldValues()');
    const sections = ev('ENV_SECTIONS');
    const bogus = [];

    Object.entries(sections).forEach(([secName, sec]) => {
      if (sec.fields) sec.fields.forEach(f => {
        if (!(f in defaults)) bogus.push(`${f} in section ${secName} not in defaults`);
      });
    });

    expect(bogus).toEqual([]);
  });

  test('every section in ENV_SECTIONS has a matching data-section element', () => {
    const sections = ev('ENV_SECTIONS');
    const missing = [];

    Object.keys(sections).forEach(secName => {
      const el = document.querySelector(`[data-section="${secName}"]`);
      if (!el) missing.push(secName);
    });

    expect(missing).toEqual([]);
  });

  test('SECTION_YAML_KEYS covers every section in ENV_SECTIONS', () => {
    const envSections = Object.keys(ev('ENV_SECTIONS'));
    const yamlKeys = Object.keys(ev('SECTION_YAML_KEYS'));
    const missing = envSections.filter(s => !yamlKeys.includes(s));
    expect(missing).toEqual([]);
  });
});

// ─── Adding environments ────────────────────────────────
describe('Adding environments', () => {
  test('addEnvironment creates a new env with correct name', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    const app = getApp();
    expect(app.environments).toHaveLength(1);
    expect(app.environments[0].name).toBe('dev');
    expect(app.environments[0].sections).toEqual([]);
  });

  test('addEnvironment does nothing on empty name', () => {
    window.prompt = () => '';
    ev('addEnvironment()');
    expect(getApp().environments).toHaveLength(0);
  });

  test('addEnvironment does nothing on cancelled prompt', () => {
    window.prompt = () => null;
    ev('addEnvironment()');
    expect(getApp().environments).toHaveLength(0);
  });

  test('can add multiple environments', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    window.prompt = () => 'staging';
    ev('addEnvironment()');
    window.prompt = () => 'prod';
    ev('addEnvironment()');
    expect(getApp().environments).toHaveLength(3);
    expect(getApp().environments.map(e => e.name)).toEqual(['dev', 'staging', 'prod']);
  });

  test('new env state is cloned from base', () => {
    setVal('imageTag', 'v1.0.0');
    setVal('reqCpu', '500m');
    ev('saveCurrentAppState()');

    window.prompt = () => 'dev';
    ev('addEnvironment()');

    const env = getApp().environments[0];
    expect(env.state.fields.imageTag).toBe('v1.0.0');
    expect(env.state.fields.reqCpu).toBe('500m');
  });
});

// ─── Removing environments ──────────────────────────────
describe('Removing environments', () => {
  beforeEach(() => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    window.prompt = () => 'prod';
    ev('addEnvironment()');
  });

  test('removeEnvironment removes the env', () => {
    ev('removeEnvironment(0)');
    expect(getApp().environments).toHaveLength(1);
    expect(getApp().environments[0].name).toBe('prod');
  });

  test('removeEnvironment switches to base if active env is removed', () => {
    ev('switchEnvironment(0)');
    ev('removeEnvironment(0)');
    expect(getApp().activeEnvIdx).toBe(-1);
  });

  test('removeEnvironment adjusts activeEnvIdx when removing before active', () => {
    ev('switchEnvironment(1)'); // prod
    ev('removeEnvironment(0)'); // remove dev
    expect(getApp().activeEnvIdx).toBe(0); // prod is now at index 0
  });
});

// ─── Switching environments ─────────────────────────────
describe('Switching environments', () => {
  beforeEach(() => {
    setVal('imageTag', 'base-tag');
    setVal('reqCpu', '100m');
    ev('saveCurrentAppState()');
    ev('generate()');

    window.prompt = () => 'dev';
    ev('addEnvironment()');
  });

  test('switchEnvironment sets activeEnvIdx', () => {
    ev('switchEnvironment(0)');
    expect(getApp().activeEnvIdx).toBe(0);
  });

  test('switchEnvironment(-1) returns to base', () => {
    ev('switchEnvironment(0)');
    ev('switchEnvironment(-1)');
    expect(getApp().activeEnvIdx).toBe(-1);
  });

  test('switching to env loads env state', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    setVal('imageTag', 'dev-tag');
    ev('saveEnvState()');

    // Switch to base, then back to dev
    ev('switchEnvironment(-1)');
    expect(document.getElementById('imageTag').value).toBe('base-tag');

    ev('switchEnvironment(0)');
    expect(document.getElementById('imageTag').value).toBe('dev-tag');
  });

  test('switching to base restores base values', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('resources')");
    setVal('reqCpu', '999m');

    ev('switchEnvironment(-1)');
    expect(document.getElementById('reqCpu').value).toBe('100m');
  });

  test('base state is not corrupted after env switching', () => {
    // Modify dev
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    setVal('imageTag', 'dev-only');
    ev('saveEnvState()');

    // Switch back to base
    ev('switchEnvironment(-1)');
    expect(document.getElementById('imageTag').value).toBe('base-tag');

    // Switch to dev and back multiple times
    ev('switchEnvironment(0)');
    ev('switchEnvironment(-1)');
    ev('switchEnvironment(0)');
    ev('switchEnvironment(-1)');
    expect(document.getElementById('imageTag').value).toBe('base-tag');
  });
});

// ─── Section overrides ──────────────────────────────────
describe('Section overrides', () => {
  beforeEach(() => {
    setVal('imageTag', 'base-tag');
    ev('saveCurrentAppState()');
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
  });

  test('addSectionOverride adds section to env', () => {
    ev("addSectionOverride('image')");
    expect(getApp().environments[0].sections).toContain('image');
  });

  test('addSectionOverride does not duplicate sections', () => {
    ev("addSectionOverride('image')");
    ev("addSectionOverride('image')");
    expect(getApp().environments[0].sections.filter(s => s === 'image')).toHaveLength(1);
  });

  test('removeSectionOverride removes section from env', () => {
    ev("addSectionOverride('image')");
    ev("addSectionOverride('resources')");
    ev("removeSectionOverride('image')");
    expect(getApp().environments[0].sections).not.toContain('image');
    expect(getApp().environments[0].sections).toContain('resources');
  });

  test('removeSectionOverride restores base values for that section', () => {
    ev("addSectionOverride('image')");
    setVal('imageTag', 'overridden');
    ev("removeSectionOverride('image')");
    expect(document.getElementById('imageTag').value).toBe('base-tag');
  });
});

// ─── UI state (env mode) ────────────────────────────────
describe('UI env mode', () => {
  beforeEach(() => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
  });

  test('form panel gets env-mode class when env is active', () => {
    ev('switchEnvironment(0)');
    expect(document.getElementById('form-panel').classList.contains('env-mode')).toBe(true);
  });

  test('form panel loses env-mode class when back to base', () => {
    ev('switchEnvironment(0)');
    ev('switchEnvironment(-1)');
    expect(document.getElementById('form-panel').classList.contains('env-mode')).toBe(false);
  });

  test('override bar is visible in env mode', () => {
    ev('switchEnvironment(0)');
    expect(document.getElementById('env-override-bar').classList.contains('visible')).toBe(true);
  });

  test('override bar is hidden in base mode', () => {
    ev('switchEnvironment(0)');
    ev('switchEnvironment(-1)');
    expect(document.getElementById('env-override-bar').classList.contains('visible')).toBe(false);
  });

  test('override title shows env name', () => {
    ev('switchEnvironment(0)');
    expect(document.getElementById('env-override-title').textContent).toBe('dev — Overrides');
  });

  test('sections are hidden when not overridden', () => {
    ev('switchEnvironment(0)');
    const allSections = document.querySelectorAll('#sections-container .section');
    const hiddenSections = document.querySelectorAll('#sections-container .section.env-hidden');
    expect(hiddenSections.length).toBe(allSections.length);
  });

  test('overridden sections become visible', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    const imgSection = document.querySelector('[data-section="image"]');
    expect(imgSection.classList.contains('env-hidden')).toBe(false);
  });

  test('non-overridden sections stay hidden', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    const resSection = document.querySelector('[data-section="resources"]');
    expect(resSection.classList.contains('env-hidden')).toBe(true);
  });

  test('all sections visible when back to base', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    ev('switchEnvironment(-1)');
    const hiddenSections = document.querySelectorAll('#sections-container .section.env-hidden');
    expect(hiddenSections.length).toBe(0);
  });
});

// ─── Env tabs rendering ─────────────────────────────────
describe('Env tabs bar', () => {
  test('env tabs bar is hidden when no envs', () => {
    const bar = document.getElementById('env-tabs-bar');
    expect(bar.classList.contains('visible')).toBe(false);
  });

  test('env tabs bar is visible when envs exist', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    const bar = document.getElementById('env-tabs-bar');
    expect(bar.classList.contains('visible')).toBe(true);
  });

  test('env tabs bar has Base tab and env tabs', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    window.prompt = () => 'prod';
    ev('addEnvironment()');
    const bar = document.getElementById('env-tabs-bar');
    const tabs = bar.querySelectorAll('.env-tab');
    expect(tabs.length).toBe(3); // Base + dev + prod
    expect(tabs[0].textContent).toContain('Base');
    expect(tabs[1].textContent).toContain('dev');
    expect(tabs[2].textContent).toContain('prod');
  });

  test('Base tab is active by default', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    const bar = document.getElementById('env-tabs-bar');
    const baseTab = bar.querySelector('.base-tab');
    expect(baseTab.classList.contains('active')).toBe(true);
  });

  test('env tab gets active class when switched to', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
    const bar = document.getElementById('env-tabs-bar');
    const tabs = bar.querySelectorAll('.env-tab');
    expect(tabs[0].classList.contains('active')).toBe(false); // Base
    expect(tabs[1].classList.contains('active')).toBe(true);  // dev
  });

  test('GitOps Zip button is hidden when no envs', () => {
    expect(document.getElementById('gitops-zip-btn').style.display).toBe('none');
  });

  test('GitOps Zip button is visible when envs exist', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    expect(document.getElementById('gitops-zip-btn').style.display).not.toBe('none');
  });

  test('env tabs bar has add env button', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    const bar = document.getElementById('env-tabs-bar');
    const addBtn = bar.querySelector('.add-env-tab');
    expect(addBtn).not.toBeNull();
    expect(addBtn.textContent).toContain('+');
  });
});

// ─── Env YAML generation ────────────────────────────────
describe('Environment YAML generation', () => {
  beforeEach(() => {
    setVal('imageRepo', 'my-app');
    setVal('imageTag', 'v1.0.0');
    setVal('reqCpu', '100m');
    setVal('reqMem', '128Mi');
    setVal('replicaCount', '2');
    ev('saveCurrentAppState()');
    ev('generate()');

    window.prompt = () => 'dev';
    ev('addEnvironment()');
  });

  test('env YAML has environment comment header', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    const yaml = generate();
    expect(yaml).toContain('# Environment: dev');
    expect(yaml).toContain('# Override values');
  });

  test('env YAML contains only overridden sections', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    setVal('imageTag', 'dev-latest');
    const yaml = generate();
    expect(yaml).toContain('image:');
    expect(yaml).toContain('dev-latest');
    // Should NOT contain non-overridden sections
    expect(yaml).not.toMatch(/^resources:/m);
    expect(yaml).not.toMatch(/^replicaCount:/m);
    expect(yaml).not.toMatch(/^service:/m);
  });

  test('env YAML includes multiple overridden sections', () => {
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    ev("addSectionOverride('resources')");
    setVal('imageTag', 'dev-latest');
    setVal('reqCpu', '500m');
    const yaml = generate();
    expect(yaml).toContain('image:');
    expect(yaml).toContain('dev-latest');
    expect(yaml).toContain('resources:');
    expect(yaml).toContain('500m');
  });

  test('empty env produces only comment header', () => {
    ev('switchEnvironment(0)');
    const yaml = generate();
    expect(yaml).toContain('# Environment: dev');
    // Should be mostly empty (just comments)
    const nonCommentLines = yaml.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    expect(nonCommentLines.length).toBe(0);
  });

  test('base YAML is full when base is active', () => {
    // Verify base still generates full YAML
    const yaml = generate();
    expect(yaml).toContain('workload:');
    expect(yaml).toContain('image:');
    expect(yaml).toContain('replicaCount:');
    expect(yaml).toContain('service:');
    expect(yaml).not.toContain('# Environment:');
  });

  test('preview filename shows env path', () => {
    ev('switchEnvironment(0)');
    const filename = document.getElementById('preview-filename').textContent;
    expect(filename).toBe('envs/dev/values.yaml');
  });

  test('preview filename shows base path when back to base', () => {
    ev('switchEnvironment(0)');
    ev('switchEnvironment(-1)');
    const filename = document.getElementById('preview-filename').textContent;
    expect(filename).toContain('values.yaml');
    expect(filename).not.toContain('envs/');
  });
});

// ─── Override picker ────────────────────────────────────
describe('Override picker', () => {
  beforeEach(() => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
  });

  test('openOverridePicker shows the modal', () => {
    ev('openOverridePicker()');
    const modal = document.getElementById('override-picker-modal');
    expect(modal.classList.contains('show')).toBe(true);
  });

  test('override picker lists all sections', () => {
    ev('openOverridePicker()');
    const items = document.querySelectorAll('.override-picker-item');
    expect(items.length).toBe(Object.keys(ev('ENV_SECTIONS')).length);
  });

  test('override picker marks active sections as disabled', () => {
    ev("addSectionOverride('image')");
    ev('openOverridePicker()');
    const items = document.querySelectorAll('.override-picker-item');
    const imageItem = Array.from(items).find(i => i.textContent.includes('Image'));
    expect(imageItem.classList.contains('disabled')).toBe(true);
  });

  test('filterOverridePicker filters by name', () => {
    ev('openOverridePicker()');
    document.getElementById('override-picker-search').value = 'image';
    ev('filterOverridePicker()');
    const visibleItems = Array.from(document.querySelectorAll('.override-picker-item'))
      .filter(i => i.style.display !== 'none');
    expect(visibleItems.length).toBeGreaterThan(0);
    expect(visibleItems.every(i => i.dataset.name.includes('image'))).toBe(true);
  });

  test('addSectionOverride closes the modal', () => {
    ev('openOverridePicker()');
    ev("addSectionOverride('resources')");
    const modal = document.getElementById('override-picker-modal');
    expect(modal.classList.contains('show')).toBe(false);
  });
});

// ─── Zip creation ───────────────────────────────────────
describe('Zip creation', () => {
  test('createZip produces valid zip header', () => {
    const zip = ev('createZip')([{ name: 'test.txt', content: 'hello' }]);
    expect(zip.constructor.name).toBe('Uint8Array');
    // PK header
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  test('createZip includes all files', () => {
    const files = [
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
      { name: 'c.txt', content: 'ccc' }
    ];
    const zip = ev('createZip')(files);
    // End-of-central-directory record has file count
    // Find EOCD signature (0x06054b50)
    let eocdPos = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i+1] === 0x4b && zip[i+2] === 0x05 && zip[i+3] === 0x06) {
        eocdPos = i;
        break;
      }
    }
    expect(eocdPos).toBeGreaterThan(-1);
    // File count at offset 8 from EOCD
    const view = new DataView(zip.buffer, eocdPos);
    expect(view.getUint16(8, true)).toBe(3);
  });

  test('createZip stores file content correctly', () => {
    const content = 'Hello, World!';
    const zip = ev('createZip')([{ name: 'test.txt', content }]);
    // Content should appear in the zip (stored, not compressed)
    const zipStr = new TextDecoder().decode(zip);
    expect(zipStr).toContain(content);
  });

  test('crc32 produces consistent results', () => {
    const data = new TextEncoder().encode('test');
    const crc1 = ev('crc32')(data);
    const crc2 = ev('crc32')(data);
    expect(crc1).toBe(crc2);
    expect(typeof crc1).toBe('number');
    expect(crc1).toBeGreaterThan(0);
  });
});

// ─── generateEnvOnlyYaml ────────────────────────────────
describe('generateEnvOnlyYaml', () => {
  test('extracts only allowed sections from full YAML', () => {
    const fullYaml = `workload:
  type: deployment

image:
  repository: nginx
  tag: "v1"

replicaCount: 2

resources:
  requests:
    cpu: 100m

service:
  enabled: true
`;
    const app = getApp();
    const env = { name: 'test', sections: ['image', 'resources'] };
    const result = ev('generateEnvOnlyYaml')(fullYaml, app, env);
    expect(result).toContain('image:');
    expect(result).toContain('repository: nginx');
    expect(result).toContain('resources:');
    expect(result).toContain('cpu: 100m');
    expect(result).not.toContain('workload:');
    expect(result).not.toContain('replicaCount:');
    expect(result).not.toContain('service:');
  });

  test('includes env name comment', () => {
    const result = ev('generateEnvOnlyYaml')('image:\n  tag: v1\n', getApp(), { name: 'prod', sections: ['image'] });
    expect(result).toContain('# Environment: prod');
  });

  test('empty sections list produces only comments', () => {
    const result = ev('generateEnvOnlyYaml')('image:\n  tag: v1\n', getApp(), { name: 'empty', sections: [] });
    const nonCommentLines = result.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    expect(nonCommentLines.length).toBe(0);
  });

  test('handles workload section YAML keys correctly', () => {
    const fullYaml = `nameOverride: "myapp"

workload:
  type: deployment

replicaCount: 3

image:
  repository: nginx
`;
    const env = { name: 'test', sections: ['workload'] };
    const result = ev('generateEnvOnlyYaml')(fullYaml, getApp(), env);
    expect(result).toContain('nameOverride:');
    expect(result).toContain('workload:');
    expect(result).toContain('replicaCount:');
    expect(result).not.toContain('image:');
  });
});

// ─── Renaming environments ──────────────────────────────
describe('Renaming environments', () => {
  beforeEach(() => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
  });

  test('finishRenameEnv updates env name', () => {
    const input = { value: 'development' };
    ev('finishRenameEnv')(0, input);
    expect(getApp().environments[0].name).toBe('development');
  });

  test('finishRenameEnv keeps old name on empty input', () => {
    const input = { value: '  ' };
    ev('finishRenameEnv')(0, input);
    expect(getApp().environments[0].name).toBe('dev');
  });

  test('finishRenameEnv updates preview filename if active', () => {
    ev('switchEnvironment(0)');
    const input = { value: 'development' };
    ev('finishRenameEnv')(0, input);
    expect(document.getElementById('preview-filename').textContent).toBe('envs/development/values.yaml');
  });
});

// ─── switchApp with environments ────────────────────────
describe('switchApp with environments', () => {
  test('switching apps exits env mode', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
    expect(getApp().activeEnvIdx).toBe(0);

    // Add another app
    ev('addApp()');
    // Now we're on app-2, should not be in env mode
    expect(getApp().activeEnvIdx).toBe(-1);
    expect(getApp().environments).toEqual([]);
  });
});

// ─── Edge cases ─────────────────────────────────────────
describe('Edge cases', () => {
  test('switchEnvironment to same index is a no-op', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
    setVal('imageTag', 'test');
    // Switching to same env should not reload/reset
    ev('switchEnvironment(0)');
    expect(document.getElementById('imageTag').value).toBe('test');
  });

  test('multiple overrides on same env accumulate correctly', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    ev("addSectionOverride('resources')");
    ev("addSectionOverride('command')");
    ev("addSectionOverride('env')");
    expect(getApp().environments[0].sections).toEqual(['image', 'resources', 'command', 'env']);
  });

  test('removing all overrides results in empty env YAML', () => {
    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    ev("removeSectionOverride('image')");
    const yaml = generate();
    const nonCommentLines = yaml.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    expect(nonCommentLines.length).toBe(0);
  });

  test('env state persists through base round-trip', () => {
    setVal('imageTag', 'base');
    ev('saveCurrentAppState()');

    window.prompt = () => 'dev';
    ev('addEnvironment()');
    ev('switchEnvironment(0)');
    ev("addSectionOverride('image')");
    setVal('imageTag', 'dev-value');
    ev('saveEnvState()');

    // Round-trip: dev → base → dev
    ev('switchEnvironment(-1)');
    ev('switchEnvironment(0)');
    expect(document.getElementById('imageTag').value).toBe('dev-value');
  });
});
