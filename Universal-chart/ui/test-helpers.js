/**
 * Extract pure functions from the UI's index.html for unit testing.
 * These are re-implementations of the inline functions that don't depend on the DOM.
 */

// yamlVal — quote YAML values correctly
function yamlVal(v) {
  if (v === '' || v === undefined || v === null) return '""';
  if (v === 'true' || v === 'false') return v;
  if (/^\d+$/.test(v)) return v;
  if (/^[\w.\-\/\:]+$/.test(v) && !/^\d/.test(v) && !['true', 'false', 'null', 'yes', 'no'].includes(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// esc — HTML entity escape for form values
function esc(v) { return String(v ?? '').replace(/"/g, '&quot;'); }

// escHtml — HTML entity escaping
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// isNum — check if value is numeric
function isNum(v) { return /^\d+$/.test(v); }

// parseValue — convert string values to appropriate types
function parseValue(v) {
  if (!v || v === '~' || v === 'null') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

// parseSimpleYaml — minimal YAML parser
function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ obj: root, indent: -1, isArray: false }];
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const trimmed = raw.replace(/\r$/, '');
    if (!trimmed.trim() || trimmed.trim().startsWith('#')) continue;
    const indent = trimmed.search(/\S/);
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (trimmed.trim().startsWith('- ')) {
      const content = trimmed.trim().slice(2).trim();
      if (Array.isArray(parent)) {
        const dashPos = trimmed.indexOf('-');
        const contentIndent = dashPos + 2;
        if (content.includes(': ') || content.match(/^[\w.\-\/][^:]*:\s*$/)) {
          const item = {};
          const km = content.match(/^([^\s:][^:]*):\s*(.*)/);
          if (km) {
            const key = km[1].trim();
            const val = km[2].trim();
            if (val === '' || val === '{}') {
              if (li + 1 < lines.length) {
                const next = lines[li + 1]?.replace(/\r$/, '');
                const ni = next ? next.search(/\S/) : -1;
                if (ni >= contentIndent && next && next.trim().startsWith('- ')) {
                  item[key] = [];
                  stack.push({ obj: item, indent: indent, isArray: false });
                  stack.push({ obj: item[key], indent: contentIndent - 1, isArray: true });
                } else if (ni >= contentIndent && next && next.trim() && !next.trim().startsWith('#')) {
                  item[key] = {};
                  stack.push({ obj: item, indent: indent, isArray: false });
                  stack.push({ obj: item[key], indent: contentIndent - 1, isArray: true });
                } else {
                  item[key] = val === '{}' ? {} : null;
                  stack.push({ obj: item, indent: indent, isArray: false });
                }
              } else {
                item[key] = val === '{}' ? {} : null;
                stack.push({ obj: item, indent: indent, isArray: false });
              }
            } else if (val.startsWith('[')) {
              const inner = val.slice(1, -1);
              item[key] = inner.split(',').map(s => parseValue(s.trim()));
              stack.push({ obj: item, indent: indent, isArray: false });
            } else if (val.startsWith('|')) {
              item[key] = '';
              while (li + 1 < lines.length && lines[li + 1].search(/\S/) > contentIndent) { li++; }
              stack.push({ obj: item, indent: indent, isArray: false });
            } else {
              item[key] = parseValue(val);
              stack.push({ obj: item, indent: indent, isArray: false });
            }
          }
          parent.push(item);
        } else {
          parent.push(parseValue(content));
        }
      }
      continue;
    }
    const m = trimmed.trim().match(/^([^\s:][^:]*):\s*(.*)/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].trim();
      if (val === '' || val === '{}') {
        if (li + 1 < lines.length) {
          const next = lines[li + 1]?.replace(/\r$/, '');
          const ni = next ? next.search(/\S/) : -1;
          if (ni > indent && next && next.trim().startsWith('- ')) {
            parent[key] = [];
            stack.push({ obj: parent[key], indent: indent, isArray: true });
          } else if (ni > indent && next && next.trim() && !next.trim().startsWith('#')) {
            parent[key] = {};
            stack.push({ obj: parent[key], indent: indent, isArray: false });
          } else {
            parent[key] = val === '{}' ? {} : null;
          }
        } else {
          parent[key] = val === '{}' ? {} : null;
        }
      } else if (val.startsWith('[')) {
        const inner = val.slice(1, -1);
        parent[key] = inner.split(',').map(s => parseValue(s.trim()));
      } else if (val.startsWith('|')) {
        const parts = [];
        while (li + 1 < lines.length && (lines[li + 1].trim() === '' || lines[li + 1].search(/\S/) > indent)) {
          li++;
          parts.push(lines[li].replace(/\r$/, ''));
        }
        const nonEmpty = parts.filter(l => l.trim());
        const minInd = nonEmpty.length ? Math.min(...nonEmpty.map(l => l.search(/\S/))) : 0;
        parent[key] = parts.map(l => l.slice(minInd)).join('\n').trim();
      } else {
        parent[key] = parseValue(val);
      }
    }
  }
  return root;
}

// cleanK8sObject — strip runtime fields from K8s objects
function cleanK8sObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  delete obj.status;
  const meta = obj.metadata;
  if (meta && typeof meta === 'object') {
    const drop = ['resourceVersion', 'uid', 'creationTimestamp', 'generation', 'selfLink',
      'managedFields', 'finalizers', 'ownerReferences', 'deletionTimestamp', 'deletionGracePeriodSeconds'];
    drop.forEach(k => delete meta[k]);
    if (meta.annotations && typeof meta.annotations === 'object') {
      const runtimeAnns = [
        'kubectl.kubernetes.io/last-applied-configuration',
        'deployment.kubernetes.io/revision',
        'kubernetes.io/change-cause',
        'control-plane.alpha.kubernetes.io/',
        'autopilot.gke.io/',
        'cloud.google.com/neg-status',
      ];
      Object.keys(meta.annotations).forEach(k => {
        if (runtimeAnns.some(ra => k === ra || k.startsWith(ra))) delete meta.annotations[k];
      });
      if (!Object.keys(meta.annotations).length) delete meta.annotations;
    }
    if (meta.labels && typeof meta.labels === 'object') {
      const runtimeLabels = [
        'pod-template-hash',
        'controller-revision-hash',
        'statefulset.kubernetes.io/pod-name',
      ];
      Object.keys(meta.labels).forEach(k => {
        if (runtimeLabels.includes(k)) delete meta.labels[k];
      });
      if (!Object.keys(meta.labels).length) delete meta.labels;
    }
  }
  // Clean spec
  if (obj.spec && typeof obj.spec === 'object') {
    const jPod = obj.spec.template?.spec || obj.spec;
    if (jPod.terminationGracePeriodSeconds === 30) delete jPod.terminationGracePeriodSeconds;
    if (jPod.dnsPolicy === 'ClusterFirst') delete jPod.dnsPolicy;
  }
  return obj;
}

module.exports = {
  yamlVal,
  esc,
  escHtml,
  isNum,
  parseValue,
  parseSimpleYaml,
  cleanK8sObject,
};
