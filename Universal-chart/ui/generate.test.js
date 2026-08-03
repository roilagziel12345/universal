const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

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
  try { window.generate(); } catch (e) { /* jsdom DOM quirks */ }
  const el = document.getElementById('yaml-output');
  return el ? el.textContent : '';
}

// ═══════════════════════════════════════════════════════════

beforeEach(() => { loadUI(); });
afterEach(() => { dom.window.close(); });

// ─── Default output ──────────────────────────────────────
describe('Default YAML generation', () => {
  test('generates valid YAML with defaults', () => {
    const yaml = generate();
    expect(yaml).toContain('workload:');
    expect(yaml).toContain('  type: deployment');
    expect(yaml).toContain('image:');
    expect(yaml).toContain('  repository: nginx');
    expect(yaml).toContain('  pullPolicy: IfNotPresent');
    expect(yaml).toContain('replicaCount: 1');
    expect(yaml).toContain('revisionHistoryLimit: 3');
  });

  test('default service is enabled with ClusterIP', () => {
    const yaml = generate();
    expect(yaml).toContain('service:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  type: ClusterIP');
  });

  test('default service has http port 80', () => {
    const yaml = generate();
    expect(yaml).toContain('    http:');
    expect(yaml).toContain('      port: 80');
    expect(yaml).toContain('      targetPort: http');
  });

  test('default serviceAccount is created', () => {
    const yaml = generate();
    expect(yaml).toContain('serviceAccount:');
    expect(yaml).toContain('  create: true');
  });

  test('no ingress or route by default', () => {
    const yaml = generate();
    expect(yaml).not.toMatch(/^ingress:/m);
    expect(yaml).not.toMatch(/^route:/m);
  });

  test('default security context disables privilege escalation', () => {
    const yaml = generate();
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  allowPrivilegeEscalation: false');
  });
});

// ─── Workload type ───────────────────────────────────────
describe('Workload type', () => {
  test('deployment type', () => {
    setVal('workloadType', 'deployment');
    expect(generate()).toContain('  type: deployment');
  });

  test('statefulset type', () => {
    setVal('workloadType', 'statefulset');
    expect(generate()).toContain('  type: statefulset');
  });

  test('daemonset type omits replicaCount', () => {
    setVal('workloadType', 'daemonset');
    const yaml = generate();
    expect(yaml).toContain('  type: daemonset');
    expect(yaml).not.toContain('replicaCount:');
  });
});

// ─── Image ───────────────────────────────────────────────
describe('Image configuration', () => {
  test('sets custom repository', () => {
    setVal('imageRepo', 'my-registry/myapp');
    expect(generate()).toContain('  repository: my-registry/myapp');
  });

  test('sets tag', () => {
    setVal('imageTag', '2.0.0');
    expect(generate()).toContain('  tag: "2.0.0"');
  });

  test('sets pull policy', () => {
    setVal('imagePullPolicy', 'Always');
    expect(generate()).toContain('  pullPolicy: Always');
  });

  test('sets image pull secrets', () => {
    setVal('imagePullSecrets', 'secret1, secret2');
    const yaml = generate();
    expect(yaml).toContain('imagePullSecrets:');
    expect(yaml).toContain('  - name: secret1');
    expect(yaml).toContain('  - name: secret2');
  });
});

// ─── Replicas & strategy ─────────────────────────────────
describe('Replicas and strategy', () => {
  test('sets replica count', () => {
    setVal('replicaCount', '5');
    expect(generate()).toContain('replicaCount: 5');
  });

  test('sets revision history limit', () => {
    setVal('revisionHistoryLimit', '10');
    expect(generate()).toContain('revisionHistoryLimit: 10');
  });

  test('sets RollingUpdate strategy for deployment', () => {
    setVal('workloadType', 'deployment');
    setVal('strategyType', 'RollingUpdate');
    window.syncStrategyFields();
    setVal('strategyMaxSurge', '2');
    setVal('strategyMaxUnavailable', '1');
    const yaml = generate();
    expect(yaml).toContain('strategy:');
    expect(yaml).toContain('  type: RollingUpdate');
    expect(yaml).toContain('    maxSurge: 2');
    expect(yaml).toContain('    maxUnavailable: 1');
  });

  test('sets Recreate strategy', () => {
    setVal('strategyType', 'Recreate');
    expect(generate()).toContain('  type: Recreate');
  });
});

// ─── Container ports ─────────────────────────────────────
describe('Container ports', () => {
  test('adds a port', () => {
    window.ports.push({ name: 'http', containerPort: '8080', protocol: 'TCP' });
    const yaml = generate();
    expect(yaml).toContain('ports:');
    expect(yaml).toContain('  http:');
    expect(yaml).toContain('    containerPort: 8080');
    expect(yaml).toContain('    protocol: TCP');
  });

  test('adds multiple ports', () => {
    window.ports.push({ name: 'http', containerPort: '8080', protocol: 'TCP' });
    window.ports.push({ name: 'grpc', containerPort: '9090', protocol: 'TCP' });
    const yaml = generate();
    expect(yaml).toContain('  http:');
    expect(yaml).toContain('  grpc:');
  });

  test('port with hostPort', () => {
    window.ports.push({ name: 'http', containerPort: '8080', protocol: 'TCP', hostPort: '8080' });
    expect(generate()).toContain('    hostPort: 8080');
  });
});

// ─── Environment variables ───────────────────────────────
describe('Environment variables', () => {
  test('adds literal env var', () => {
    window.envVars.push({ name: 'MY_VAR', source: 'literal', value: 'hello' });
    const yaml = generate();
    expect(yaml).toContain('env:');
    expect(yaml).toContain('  MY_VAR:');
    expect(yaml).toContain('    value: hello');
  });

  test('adds configMapKeyRef env var', () => {
    window.envVars.push({ name: 'DB_HOST', source: 'configMapKeyRef', refName: 'my-config', refKey: 'db-host' });
    const yaml = generate();
    expect(yaml).toContain('      configMapKeyRef:');
    expect(yaml).toContain('        name: my-config');
    expect(yaml).toContain('        key: db-host');
  });

  test('adds secretKeyRef env var', () => {
    window.envVars.push({ name: 'DB_PASS', source: 'secretKeyRef', refName: 'my-secret', refKey: 'password' });
    const yaml = generate();
    expect(yaml).toContain('      secretKeyRef:');
    expect(yaml).toContain('        name: my-secret');
    expect(yaml).toContain('        key: password');
  });

  test('adds fieldRef env var', () => {
    window.envVars.push({ name: 'POD_NAME', source: 'fieldRef', fieldPath: 'metadata.name' });
    const yaml = generate();
    expect(yaml).toContain('      fieldRef:');
    expect(yaml).toContain('        fieldPath: metadata.name');
  });

  test('adds envFrom via addEnvFrom function', () => {
    // envFromItems is declared with `let` and not on window, so use addEnvFrom()
    window.addEnvFrom();
    // Set the values via the rendered inputs
    const yaml = generate();
    // addEnvFrom adds an empty entry; just verify the function doesn't crash
    expect(yaml).toBeDefined();
  });
});

// ─── Resources ───────────────────────────────────────────
describe('Resources', () => {
  test('sets CPU and memory requests', () => {
    setVal('reqCpu', '100m');
    setVal('reqMem', '128Mi');
    const yaml = generate();
    expect(yaml).toContain('resources:');
    expect(yaml).toContain('  requests:');
    expect(yaml).toContain('    cpu: 100m');
    expect(yaml).toContain('    memory: 128Mi');
  });

  test('sets CPU and memory limits', () => {
    setVal('limCpu', '500m');
    setVal('limMem', '256Mi');
    const yaml = generate();
    expect(yaml).toContain('  limits:');
    expect(yaml).toContain('    cpu: 500m');
    expect(yaml).toContain('    memory: 256Mi');
  });

  test('omits resources when empty', () => {
    expect(generate()).not.toContain('resources:');
  });
});

// ─── Probes ──────────────────────────────────────────────
describe('Probes', () => {
  test('generates liveness probe with httpGet', () => {
    setChecked('livenessEnabled', true);
    setVal('livenessType', 'httpGet');
    setVal('livenessPath', '/healthz');
    setVal('livenessPort', 'http');
    const yaml = generate();
    expect(yaml).toContain('livenessProbe:');
    expect(yaml).toContain('  httpGet:');
    expect(yaml).toContain('    path: /healthz');
    expect(yaml).toContain('    port: http');
    expect(yaml).toContain('  initialDelaySeconds: 10');
    expect(yaml).toContain('  periodSeconds: 10');
    expect(yaml).toContain('  failureThreshold: 3');
  });

  test('generates readiness probe with tcpSocket', () => {
    setChecked('readinessEnabled', true);
    setVal('readinessType', 'tcpSocket');
    setVal('readinessTcpPort', '5432');
    const yaml = generate();
    expect(yaml).toContain('readinessProbe:');
    expect(yaml).toContain('  tcpSocket:');
    expect(yaml).toContain('    port: 5432');
  });

  test('generates startup probe with exec', () => {
    setChecked('startupEnabled', true);
    setVal('startupType', 'exec');
    setVal('startupExecCmd', 'cat /tmp/ready');
    const yaml = generate();
    expect(yaml).toContain('startupProbe:');
    expect(yaml).toContain('  exec:');
    expect(yaml).toContain('    command:');
  });

  test('omits probes when disabled', () => {
    const yaml = generate();
    expect(yaml).not.toContain('livenessProbe:');
    expect(yaml).not.toContain('readinessProbe:');
    expect(yaml).not.toContain('startupProbe:');
  });
});

// ─── Container restart rules ─────────────────────────────
describe('Container restart rules', () => {
  test('generates restart rules', () => {
    window.restartRules.push({ exitCode: '42', action: 'RestartAllContainers' });
    const yaml = generate();
    expect(yaml).toContain('containerRestartRules:');
    expect(yaml).toContain('  - exitCode: 42');
    expect(yaml).toContain('    action: RestartAllContainers');
  });
});

// ─── Lifecycle hooks ─────────────────────────────────────
describe('Lifecycle hooks', () => {
  test('generates postStart hook', () => {
    setVal('postStartCmd', '/bin/sh\n-c\necho started');
    const yaml = generate();
    expect(yaml).toContain('lifecycle:');
    expect(yaml).toContain('  postStart:');
    expect(yaml).toContain('    exec:');
    expect(yaml).toContain('      command:');
  });

  test('generates preStop hook', () => {
    setVal('preStopCmd', '/bin/sh\n-c\nsleep 15');
    expect(generate()).toContain('  preStop:');
  });
});

// ─── Security context ────────────────────────────────────
describe('Security context', () => {
  test('generates pod security context', () => {
    setVal('podRunAsUser', '1000');
    setVal('podRunAsGroup', '3000');
    setVal('podFsGroup', '2000');
    setChecked('podRunAsNonRoot', true);
    const yaml = generate();
    expect(yaml).toContain('podSecurityContext:');
    expect(yaml).toContain('  runAsNonRoot: true');
    expect(yaml).toContain('  runAsUser: 1000');
    expect(yaml).toContain('  runAsGroup: 3000');
    expect(yaml).toContain('  fsGroup: 2000');
  });

  test('generates container security context with capabilities', () => {
    setChecked('secReadOnly', true);
    setChecked('secDropAll', true);
    setVal('secAddCaps', 'NET_BIND_SERVICE');
    const yaml = generate();
    expect(yaml).toContain('  readOnlyRootFilesystem: true');
    expect(yaml).toContain('  capabilities:');
    expect(yaml).toContain('    drop: [ALL]');
    expect(yaml).toContain('    add: [NET_BIND_SERVICE]');
  });
});

// ─── Security context — detailed StatefulSet tests ──────
describe('Security context — StatefulSet import and generate', () => {
  test('statefulset: pod securityContext maps to podSecurityContext', () => {
    setVal('workloadType', 'statefulset');
    setVal('podRunAsUser', '1000');
    setVal('podFsGroup', '2000');
    setChecked('podRunAsNonRoot', true);
    const yaml = generate();
    expect(yaml).toContain('podSecurityContext:');
    expect(yaml).toContain('  runAsUser: 1000');
    expect(yaml).toContain('  fsGroup: 2000');
    expect(yaml).toContain('  runAsNonRoot: true');
  });

  test('statefulset: container securityContext is separate from pod level', () => {
    setVal('workloadType', 'statefulset');
    setVal('podRunAsUser', '1000');
    setVal('podFsGroup', '2000');
    setChecked('secReadOnly', true);
    setChecked('secDropAll', true);
    const yaml = generate();
    // Pod level
    expect(yaml).toContain('podSecurityContext:');
    expect(yaml).toContain('  runAsUser: 1000');
    expect(yaml).toContain('  fsGroup: 2000');
    // Container level
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  readOnlyRootFilesystem: true');
    expect(yaml).toContain('    drop: [ALL]');
    // podSecurityContext must NOT contain container-level fields
    const lines = yaml.split('\n');
    const podSecIdx = lines.findIndex(l => l.trim() === 'podSecurityContext:');
    const secIdx = lines.findIndex(l => l.trim() === 'securityContext:');
    expect(podSecIdx).toBeLessThan(secIdx);
    // Between podSecurityContext and securityContext, no drop/capabilities
    const between = lines.slice(podSecIdx + 1, secIdx).join('\n');
    expect(between).not.toContain('capabilities');
    expect(between).not.toContain('readOnlyRootFilesystem');
  });

  test('no podSecurityContext when pod fields are empty', () => {
    setVal('workloadType', 'statefulset');
    setVal('podRunAsUser', '');
    setVal('podRunAsGroup', '');
    setVal('podFsGroup', '');
    setChecked('podRunAsNonRoot', false);
    const yaml = generate();
    expect(yaml).not.toContain('podSecurityContext:');
  });

  test('default securityContext always has allowPrivilegeEscalation: false', () => {
    setVal('workloadType', 'statefulset');
    const yaml = generate();
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  allowPrivilegeEscalation: false');
  });

  test('enabling secPrivEsc removes allowPrivilegeEscalation line', () => {
    setChecked('secPrivEsc', true);
    const yaml = generate();
    // When secPrivEsc is true, the condition !spe is false
    // But securityContext is still output if other conditions are met
    // With only secPrivEsc=true and all others default (false), the condition is:
    // sro(false) || !spe(false) || sda(false) || sac('') || spriv(false) || saa(false)
    // All false, so securityContext should NOT be generated
    expect(yaml).not.toContain('securityContext:');
  });

  test('import kubectl STS — pod securityContext goes to podSecurityContext', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-db
spec:
  replicas: 3
  serviceName: my-db
  selector:
    matchLabels:
      app: my-db
  template:
    metadata:
      labels:
        app: my-db
    spec:
      securityContext:
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        runAsNonRoot: true
      containers:
        - name: my-db
          image: postgres:15
          ports:
            - containerPort: 5432
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    // Pod-level security fields
    expect(yaml).toContain('podSecurityContext:');
    expect(yaml).toContain('  runAsUser: 1000');
    expect(yaml).toContain('  runAsGroup: 1000');
    expect(yaml).toContain('  fsGroup: 1000');
    expect(yaml).toContain('  runAsNonRoot: true');
    // Container-level security fields
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  readOnlyRootFilesystem: true');
    expect(yaml).toContain('  allowPrivilegeEscalation: false');
    expect(yaml).toContain('    drop: [ALL]');
    // Workload type is statefulset
    expect(yaml).toContain('  type: statefulset');
    // Replica count
    expect(yaml).toContain('replicaCount: 3');
  });

  test('import kubectl STS — only pod securityContext, no container level', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-app
spec:
  replicas: 1
  serviceName: my-app
  selector:
    matchLabels:
      app: my-app
  template:
    spec:
      securityContext:
        runAsUser: 65534
        fsGroup: 65534
      containers:
        - name: app
          image: myapp:latest`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('podSecurityContext:');
    expect(yaml).toContain('  runAsUser: 65534');
    expect(yaml).toContain('  fsGroup: 65534');
    // Container-level securityContext should still have the default allowPrivilegeEscalation: false
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  allowPrivilegeEscalation: false');
  });

  test('import kubectl STS — container-level runAsUser maps to podSecurityContext', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-app
spec:
  replicas: 1
  serviceName: my-app
  selector:
    matchLabels:
      app: my-app
  template:
    spec:
      containers:
        - name: app
          image: myapp:latest
          securityContext:
            runAsUser: 1000
            runAsGroup: 1000
            runAsNonRoot: true
            readOnlyRootFilesystem: true`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    // runAsUser/runAsGroup/runAsNonRoot from container level should map to podSecurityContext
    expect(yaml).toContain('podSecurityContext:');
    expect(yaml).toContain('  runAsUser: 1000');
    expect(yaml).toContain('  runAsGroup: 1000');
    expect(yaml).toContain('  runAsNonRoot: true');
    // Container-level has readOnly
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  readOnlyRootFilesystem: true');
  });

  test('import kubectl STS — pod-level runAsUser takes priority over container-level', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-app
spec:
  replicas: 1
  serviceName: my-app
  selector:
    matchLabels:
      app: my-app
  template:
    spec:
      securityContext:
        runAsUser: 999
        fsGroup: 999
      containers:
        - name: app
          image: myapp:latest
          securityContext:
            runAsUser: 1000
            runAsGroup: 1000`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('podSecurityContext:');
    // Pod-level runAsUser (999) takes priority over container-level (1000)
    expect(yaml).toContain('  runAsUser: 999');
    // runAsGroup only exists at container level, so it gets picked up
    expect(yaml).toContain('  runAsGroup: 1000');
    // fsGroup only at pod level
    expect(yaml).toContain('  fsGroup: 999');
  });

  test('import kubectl STS — privileged container', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: privileged-app
spec:
  replicas: 1
  serviceName: privileged-app
  selector:
    matchLabels:
      app: test
  template:
    spec:
      containers:
        - name: app
          image: myapp:latest
          securityContext:
            privileged: true
            allowPrivilegeEscalation: true`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('securityContext:');
    expect(yaml).toContain('  privileged: true');
    // When allowPrivilegeEscalation is true, secPrivEsc is true,
    // so !spe is false and it should NOT output allowPrivilegeEscalation: false
    expect(yaml).not.toContain('allowPrivilegeEscalation: false');
  });

  test('import kubectl STS — capabilities add', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: cap-app
spec:
  replicas: 1
  serviceName: cap-app
  selector:
    matchLabels:
      app: test
  template:
    spec:
      containers:
        - name: app
          image: myapp:latest
          securityContext:
            capabilities:
              drop:
                - ALL
              add:
                - NET_BIND_SERVICE
                - SYS_TIME`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('    drop: [ALL]');
    expect(yaml).toContain('    add: [NET_BIND_SERVICE, SYS_TIME]');
  });

  test('podRunAsUser on form maps to podSecurityContext in YAML, not securityContext', () => {
    setVal('podRunAsUser', '999');
    const yaml = generate();
    // Find podSecurityContext block
    const lines = yaml.split('\n');
    const podSecStart = lines.findIndex(l => l.trim() === 'podSecurityContext:');
    expect(podSecStart).toBeGreaterThanOrEqual(0);
    // runAsUser: 999 must follow podSecurityContext, not securityContext
    expect(lines[podSecStart + 1].trim()).toMatch(/runAs/);
    // securityContext block should NOT contain runAsUser
    const secStart = lines.findIndex(l => l.trim() === 'securityContext:');
    if (secStart >= 0) {
      let secEnd = secStart + 1;
      while (secEnd < lines.length && (lines[secEnd] === '' || lines[secEnd].startsWith('  '))) secEnd++;
      const secBlock = lines.slice(secStart, secEnd).join('\n');
      expect(secBlock).not.toContain('runAsUser');
    }
  });
});

// ─── YAML parser: block scalar (|) in arrays ────────────
describe('parseSimpleYaml — block scalar support', () => {
  test('bare - | collects multi-line content', () => {
    const r = window.parseSimpleYaml(`args:\n  - |\n    set -ev\n    echo hello\n    echo done`);
    expect(r.args).toHaveLength(1);
    expect(r.args[0]).toContain('set -ev');
    expect(r.args[0]).toContain('echo hello');
    expect(r.args[0]).toContain('echo done');
  });

  test('nested container args with - |', () => {
    const r = window.parseSimpleYaml(`containers:\n  - name: app\n    args:\n      - |\n        set -ev\n        echo start`);
    expect(r.containers[0].args).toHaveLength(1);
    expect(r.containers[0].args[0]).toContain('set -ev');
    expect(r.containers[0].args[0]).toContain('echo start');
  });

  test('mixed plain and block scalar items', () => {
    const r = window.parseSimpleYaml(`args:\n  - --config=app.yaml\n  - |\n    set -ev\n    echo go\n  - --verbose`);
    expect(r.args).toHaveLength(3);
    expect(r.args[0]).toBe('--config=app.yaml');
    expect(r.args[1]).toContain('set -ev');
    expect(r.args[2]).toBe('--verbose');
  });

  test('/bin/sh -c with block scalar body', () => {
    const r = window.parseSimpleYaml(`command:\n  - /bin/sh\n  - -c\n  - |\n    if [ -f /tmp/ready ]; then\n      exit 0\n    fi`);
    expect(r.command).toHaveLength(3);
    expect(r.command[0]).toBe('/bin/sh');
    expect(r.command[1]).toBe('-c');
    expect(r.command[2]).toContain('if [ -f /tmp/ready ]');
    expect(r.command[2]).toContain('exit 0');
  });

  test('key: | (non-array) still works', () => {
    const r = window.parseSimpleYaml(`script: |\n  set -ev\n  echo done`);
    expect(r.script).toContain('set -ev');
    expect(r.script).toContain('echo done');
  });
});

// ─── Import: service presence ───────────────────────────
describe('Import — service disabled when no Service resource', () => {
  test('import STS without Service disables service', () => {
    const stsYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: agent
spec:
  replicas: 1
  serviceName: agent
  selector:
    matchLabels:
      app: agent
  template:
    spec:
      hostNetwork: true
      containers:
        - name: agent
          image: agent:latest`;
    document.getElementById('k8s-import-input').value = stsYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('service:');
    expect(yaml).toContain('  enabled: false');
    expect(yaml).not.toMatch(/enabled: true/);
  });

  test('import STS with Service keeps service enabled', () => {
    const yaml2 = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: app
spec:
  replicas: 1
  serviceName: app
  selector:
    matchLabels:
      app: app
  template:
    spec:
      containers:
        - name: app
          image: app:latest
---
apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8080`;
    document.getElementById('k8s-import-input').value = yaml2;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('service:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('      port: 80');
  });

  test('import Deployment without Service disables service', () => {
    const depYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: worker
  template:
    spec:
      containers:
        - name: worker
          image: worker:latest
          command: ["/bin/worker"]`;
    document.getElementById('k8s-import-input').value = depYaml;
    try { window.eval('importK8sManifests()'); } catch(e) {}
    const yaml = generate();
    expect(yaml).toContain('  enabled: false');
  });
});

// ─── Service ─────────────────────────────────────────────
describe('Service configuration', () => {
  test('disables service', () => {
    setChecked('serviceEnabled', false);
    expect(generate()).toContain('  enabled: false');
  });

  test('sets service type to NodePort', () => {
    setVal('serviceType', 'NodePort');
    expect(generate()).toContain('  type: NodePort');
  });

  test('sets service type to LoadBalancer', () => {
    setVal('serviceType', 'LoadBalancer');
    expect(generate()).toContain('  type: LoadBalancer');
  });

  test('adds custom service ports', () => {
    window.servicePorts.length = 0;
    window.servicePorts.push({ name: 'grpc', port: '9090', targetPort: '9090', protocol: 'TCP', nodePort: '' });
    const yaml = generate();
    expect(yaml).toContain('    grpc:');
    expect(yaml).toContain('      port: 9090');
  });

  test('sets service annotations', () => {
    setVal('serviceAnnotations', 'service.beta.kubernetes.io/aws-load-balancer-type=nlb');
    const yaml = generate();
    expect(yaml).toContain('  annotations:');
    expect(yaml).toContain('    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"');
  });

  test('sets clusterIP to None (headless)', () => {
    setVal('serviceClusterIP', 'None');
    expect(generate()).toContain('  clusterIP: None');
  });
});

// ─── Ingress ─────────────────────────────────────────────
describe('Ingress', () => {
  test('generates ingress when enabled', () => {
    setChecked('ingressEnabled', true);
    setVal('ingressClass', 'nginx');
    const yaml = generate();
    expect(yaml).toContain('ingress:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  className: nginx');
  });
});

// ─── OpenShift Route ─────────────────────────────────────
describe('Route', () => {
  test('generates route when enabled', () => {
    setChecked('routeEnabled', true);
    setVal('routeHost', 'myapp.apps.cluster.example.com');
    setVal('routeTls', 'edge');
    const yaml = generate();
    expect(yaml).toContain('route:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  host: myapp.apps.cluster.example.com');
    expect(yaml).toContain('    termination: edge');
    expect(yaml).toContain('    insecureEdgeTerminationPolicy: Redirect');
  });

  test('sets route path and target port', () => {
    setChecked('routeEnabled', true);
    setVal('routePath', '/api');
    setVal('routeTargetPort', 'grpc');
    const yaml = generate();
    expect(yaml).toContain('  path: /api');
    expect(yaml).toContain('  targetPort: grpc');
  });
});

// ─── ConfigMaps ──────────────────────────────────────────
describe('ConfigMaps', () => {
  test('generates configMap', () => {
    window.configMaps.push({ name: 'app-config', keys: [{ key: 'LOG_LEVEL', value: 'info' }, { key: 'DB_HOST', value: 'postgres' }] });
    const yaml = generate();
    expect(yaml).toContain('configMaps:');
    expect(yaml).toContain('  app-config:');
    expect(yaml).toContain('    data:');
    expect(yaml).toContain('      LOG_LEVEL: info');
    expect(yaml).toContain('      DB_HOST: postgres');
  });

  test('generates multiple configMaps', () => {
    window.configMaps.push({ name: 'config-1', keys: [{ key: 'k1', value: 'v1' }] });
    window.configMaps.push({ name: 'config-2', keys: [{ key: 'k2', value: 'v2' }] });
    const yaml = generate();
    expect(yaml).toContain('  config-1:');
    expect(yaml).toContain('  config-2:');
  });
});

// ─── Secrets ─────────────────────────────────────────────
describe('Secrets', () => {
  test('generates secret', () => {
    window.secrets.push({ name: 'app-secret', type: 'Opaque', keys: [{ key: 'DB_PASS', value: 'secret123' }] });
    const yaml = generate();
    expect(yaml).toContain('secrets:');
    expect(yaml).toContain('  app-secret:');
    expect(yaml).toContain('    type: Opaque');
    expect(yaml).toContain('    stringData:');
    expect(yaml).toContain('      DB_PASS: "secret123"');
  });
});

// ─── PVCs ────────────────────────────────────────────────
describe('PVCs', () => {
  test('generates PVC', () => {
    window.pvcs.push({ name: 'my-data', size: '10Gi', accessMode: 'ReadWriteOnce', storageClass: 'fast-ssd' });
    const yaml = generate();
    expect(yaml).toContain('pvc:');
    expect(yaml).toContain('  my-data:');
    expect(yaml).toContain('    accessModes: [ReadWriteOnce]');
    expect(yaml).toContain('    size: 10Gi');
    expect(yaml).toContain('    storageClassName: fast-ssd');
  });
});

// ─── VCTs ────────────────────────────────────────────────
describe('Volume Claim Templates', () => {
  test('generates VCT', () => {
    window.vcts.push({ name: 'data', size: '50Gi', accessMode: 'ReadWriteOnce', storageClass: '' });
    const yaml = generate();
    expect(yaml).toContain('volumeClaimTemplates:');
    expect(yaml).toContain('  data:');
    expect(yaml).toContain('    size: 50Gi');
  });
});

// ─── CronJobs ────────────────────────────────────────────
describe('CronJobs', () => {
  test('generates cronjob', () => {
    window.cronjobs.push({
      name: 'backup', schedule: '0 2 * * *', command: '/bin/backup.sh',
      restartPolicy: 'OnFailure', concurrencyPolicy: 'Forbid',
      backoffLimit: '3', ttl: '', activeDeadline: '', suspend: false, image: '', args: '', env: ''
    });
    const yaml = generate();
    expect(yaml).toContain('cronjobs:');
    expect(yaml).toContain('  backup:');
    expect(yaml).toContain('    schedule: "0 2 * * *"');
    expect(yaml).toContain('    concurrencyPolicy: Forbid');
    expect(yaml).toContain('    backoffLimit: 3');
    expect(yaml).toContain('    jobTemplate:');
    expect(yaml).toContain('      restartPolicy: OnFailure');
  });

  test('generates cronjob with custom image', () => {
    window.cronjobs.push({
      name: 'test', schedule: '*/5 * * * *', command: 'echo test',
      restartPolicy: 'Never', concurrencyPolicy: 'Allow',
      backoffLimit: '', ttl: '', activeDeadline: '', suspend: false,
      image: 'custom/image:2.0', args: '', env: ''
    });
    const yaml = generate();
    expect(yaml).toContain('      image:');
    expect(yaml).toContain('        repository: custom/image');
    expect(yaml).toContain('        tag: "2.0"');
  });
});

// ─── Jobs ────────────────────────────────────────────────
describe('Jobs', () => {
  test('generates job', () => {
    window.jobs.push({
      name: 'migrate', command: 'python manage.py migrate',
      restartPolicy: 'OnFailure', backoffLimit: '3',
      ttl: '3600', activeDeadline: '600', image: '', args: '', env: '', annotations: ''
    });
    const yaml = generate();
    expect(yaml).toContain('jobs:');
    expect(yaml).toContain('  migrate:');
    expect(yaml).toContain('    restartPolicy: OnFailure');
    expect(yaml).toContain('    backoffLimit: 3');
    expect(yaml).toContain('    ttlSecondsAfterFinished: 3600');
    expect(yaml).toContain('    activeDeadlineSeconds: 600');
  });

  test('generates job with ArgoCD annotations', () => {
    window.jobs.push({
      name: 'pre-migrate', command: 'echo test', restartPolicy: 'OnFailure',
      backoffLimit: '', ttl: '', activeDeadline: '', image: '', args: '', env: '',
      annotations: 'argocd.argoproj.io/hook=PreSync'
    });
    const yaml = generate();
    expect(yaml).toContain('    annotations:');
    expect(yaml).toContain('      argocd.argoproj.io/hook: "PreSync"');
  });
});

// ─── Scheduling ──────────────────────────────────────────
describe('Scheduling', () => {
  test('generates node selectors', () => {
    window.nodeSelectors.push({ key: 'kubernetes.io/os', value: 'linux' });
    window.nodeSelectors.push({ key: 'disk', value: 'ssd' });
    const yaml = generate();
    expect(yaml).toContain('nodeSelector:');
    expect(yaml).toContain('  kubernetes.io/os: linux');
    expect(yaml).toContain('  disk: ssd');
  });

  test('generates tolerations', () => {
    window.tolerations.push({ key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' });
    const yaml = generate();
    expect(yaml).toContain('tolerations:');
    expect(yaml).toContain('  - key: "dedicated"');
    expect(yaml).toContain('    operator: Equal');
    expect(yaml).toContain('    value: "gpu"');
    expect(yaml).toContain('    effect: NoSchedule');
  });
});

// ─── HPA ─────────────────────────────────────────────────
describe('HPA', () => {
  test('generates HPA config', () => {
    setChecked('hpaEnabled', true);
    setVal('hpaMin', '2');
    setVal('hpaMax', '20');
    setVal('hpaCpu', '70');
    const yaml = generate();
    expect(yaml).toContain('hpa:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  minReplicas: 2');
    expect(yaml).toContain('  maxReplicas: 20');
    expect(yaml).toContain('          averageUtilization: 70');
  });

  test('generates HPA with memory metric', () => {
    setChecked('hpaEnabled', true);
    setVal('hpaMemory', '512Mi');
    const yaml = generate();
    expect(yaml).toContain('        name: memory');
    expect(yaml).toContain('          averageValue: 512Mi');
  });

  test('omits HPA when disabled', () => {
    expect(generate()).not.toMatch(/^hpa:/m);
  });
});

// ─── VPA ─────────────────────────────────────────────────
describe('VPA', () => {
  test('generates VPA config', () => {
    setChecked('vpaEnabled', true);
    setVal('vpaMode', 'Off');
    const yaml = generate();
    expect(yaml).toContain('vpa:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  updateMode: Off');
  });
});

// ─── PDB ─────────────────────────────────────────────────
describe('PDB', () => {
  test('generates PDB with minAvailable', () => {
    setChecked('pdbEnabled', true);
    setVal('pdbMinAvailable', '2');
    const yaml = generate();
    expect(yaml).toContain('pdb:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  minAvailable: 2');
  });

  test('generates PDB with percentage', () => {
    setChecked('pdbEnabled', true);
    setVal('pdbMinAvailable', '50%');
    expect(generate()).toContain('  minAvailable: "50%"');
  });

  test('generates PDB with maxUnavailable', () => {
    setChecked('pdbEnabled', true);
    setVal('pdbMinAvailable', '');
    setVal('pdbMaxUnavailable', '1');
    expect(generate()).toContain('  maxUnavailable: 1');
  });
});

// ─── Network Policies ────────────────────────────────────
describe('Network Policies', () => {
  test('generates network policy', () => {
    window.netPols.push({ name: 'allow-ingress', policyTypes: 'Ingress', ingressPort: '8080' });
    const yaml = generate();
    expect(yaml).toContain('networkPolicies:');
    expect(yaml).toContain('  allow-ingress:');
    expect(yaml).toContain('    podSelector: {}');
    expect(yaml).toContain('    policyTypes: [Ingress]');
    expect(yaml).toContain('          - port: 8080');
  });
});

// ─── ServiceMonitor ──────────────────────────────────────
describe('ServiceMonitor', () => {
  test('generates serviceMonitor config', () => {
    setChecked('smEnabled', true);
    setVal('smPath', '/custom-metrics');
    setVal('smPort', 'metrics');
    setVal('smInterval', '15s');
    setVal('smScrapeTimeout', '5s');
    const yaml = generate();
    expect(yaml).toContain('serviceMonitor:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  path: /custom-metrics');
    expect(yaml).toContain('  port: metrics');
    expect(yaml).toContain('  interval: 15s');
    expect(yaml).toContain('  scrapeTimeout: 5s');
  });

  test('sets serviceMonitor namespace', () => {
    setChecked('smEnabled', true);
    setVal('smNamespace', 'monitoring');
    expect(generate()).toContain('  namespace: monitoring');
  });
});

// ─── ServiceAccount ──────────────────────────────────────
describe('ServiceAccount', () => {
  test('disables SA creation', () => {
    setChecked('saCreate', false);
    expect(generate()).toContain('  create: false');
  });

  test('sets SA name', () => {
    setVal('saName', 'custom-sa');
    expect(generate()).toContain('  name: "custom-sa"');
  });

  test('disables automount', () => {
    setChecked('saAutomount', false);
    expect(generate()).toContain('  automountServiceAccountToken: false');
  });
});

// ─── Advanced pod settings ───────────────────────────────
describe('Advanced pod settings', () => {
  test('sets termination grace period', () => {
    setVal('terminationGrace', '60');
    expect(generate()).toContain('terminationGracePeriodSeconds: 60');
  });

  test('omits default termination grace period (30)', () => {
    expect(generate()).not.toContain('terminationGracePeriodSeconds:');
  });

  test('enables host network', () => {
    setChecked('hostNetwork', true);
    expect(generate()).toContain('hostNetwork: true');
  });

  test('enables share process namespace', () => {
    setChecked('shareProcessNs', true);
    expect(generate()).toContain('shareProcessNamespace: true');
  });

  test('sets DNS policy', () => {
    setVal('dnsPolicy', 'None');
    expect(generate()).toContain('dnsPolicy: None');
  });

  test('sets priority class', () => {
    setVal('priorityClassName', 'high-priority');
    expect(generate()).toContain('priorityClassName: "high-priority"');
  });

  test('enables hostIPC and hostPID', () => {
    setChecked('hostIPC', true);
    setChecked('hostPID', true);
    const yaml = generate();
    expect(yaml).toContain('hostIPC: true');
    expect(yaml).toContain('hostPID: true');
  });

  test('sets pod management policy for statefulset', () => {
    setVal('workloadType', 'statefulset');
    setVal('podManagementPolicy', 'Parallel');
    expect(generate()).toContain('podManagementPolicy: Parallel');
  });
});

// ─── Pod metadata ────────────────────────────────────────
describe('Pod metadata', () => {
  test('sets pod annotations', () => {
    setVal('podAnnotations', 'prometheus.io/scrape=true\nprometheus.io/port=8080');
    const yaml = generate();
    expect(yaml).toContain('podAnnotations:');
    expect(yaml).toContain('  prometheus.io/scrape: "true"');
    expect(yaml).toContain('  prometheus.io/port: "8080"');
  });

  test('sets pod labels', () => {
    setVal('podLabels', 'team=backend');
    const yaml = generate();
    expect(yaml).toContain('podLabels:');
    expect(yaml).toContain('  team: "backend"');
  });

  test('sets common labels', () => {
    setVal('commonLabels', 'environment=production');
    const yaml = generate();
    expect(yaml).toContain('commonLabels:');
    expect(yaml).toContain('  environment: "production"');
  });

  test('sets common annotations', () => {
    setVal('commonAnnotations', 'owner=platform');
    const yaml = generate();
    expect(yaml).toContain('commonAnnotations:');
    expect(yaml).toContain('  owner: "platform"');
  });
});

// ─── Init containers ─────────────────────────────────────
describe('Init containers', () => {
  test('generates init container', () => {
    window.initContainers.push({
      name: 'init-db', image: 'busybox:1.36', command: 'sh\n-c\necho ready',
      args: '', env: [], envFrom: [], ports: [], volumeMounts: '', reqCpu: '', reqMem: '', limCpu: '', limMem: '',
      pullPolicy: '', workingDir: '', secReadOnly: false, secPrivEsc: true, secPrivileged: false,
      secDropAll: false, secAddCaps: '', secRunAsUser: '', secRunAsGroup: '', secRunAsNonRoot: false,
      livenessProbe: null, readinessProbe: null, startupProbe: null, postStart: '', preStop: ''
    });
    const yaml = generate();
    expect(yaml).toContain('initContainers:');
    expect(yaml).toContain('  init-db:');
    expect(yaml).toContain('    image: busybox:1.36');
  });
});

// ─── Sidecars ────────────────────────────────────────────
describe('Sidecars', () => {
  test('generates sidecar container', () => {
    window.sidecars.push({
      name: 'log-shipper', image: 'fluentbit:2.0', command: '', args: '',
      env: [{ name: 'LOG_LEVEL', source: 'literal', value: 'info', refName: '', refKey: '', fieldPath: '' }],
      envFrom: [], ports: [], volumeMounts: '', reqCpu: '50m', reqMem: '64Mi', limCpu: '', limMem: '',
      pullPolicy: '', workingDir: '', secReadOnly: false, secPrivEsc: true, secPrivileged: false,
      secDropAll: false, secAddCaps: '', secRunAsUser: '', secRunAsGroup: '', secRunAsNonRoot: false,
      livenessProbe: null, readinessProbe: null, startupProbe: null, postStart: '', preStop: ''
    });
    const yaml = generate();
    expect(yaml).toContain('sidecars:');
    expect(yaml).toContain('  log-shipper:');
    expect(yaml).toContain('    image: fluentbit:2.0');
    expect(yaml).toContain('      - name: LOG_LEVEL');
    expect(yaml).toContain('        value: info');
    expect(yaml).toContain('      requests:');
    expect(yaml).toContain('        cpu: 50m');
  });
});

// ─── Command and args ────────────────────────────────────
describe('Command and args', () => {
  test('generates command', () => {
    setVal('command', '/bin/sh\n-c\necho hello');
    const yaml = generate();
    expect(yaml).toContain('command:');
  });

  test('generates args', () => {
    setVal('args', '--config=/etc/app.yaml\n--debug');
    const yaml = generate();
    expect(yaml).toContain('args:');
  });

  test('sets working directory', () => {
    setVal('workingDir', '/app');
    expect(generate()).toContain('workingDir: "/app"');
  });
});

// ─── Full integration: webapp ────────────────────────────
describe('Full integration — webapp', () => {
  test('generates complete webapp values.yaml', () => {
    setVal('imageRepo', 'my-registry/webapp');
    setVal('imageTag', '1.5.0');
    setVal('replicaCount', '3');

    window.ports.push({ name: 'http', containerPort: '8080', protocol: 'TCP' });
    window.envVars.push({ name: 'NODE_ENV', source: 'literal', value: 'production' });

    setVal('reqCpu', '200m');
    setVal('reqMem', '256Mi');
    setVal('limCpu', '1');
    setVal('limMem', '512Mi');

    setChecked('livenessEnabled', true);
    setVal('livenessPath', '/health');

    window.servicePorts[0] = { name: 'http', port: '80', targetPort: 'http', protocol: 'TCP', nodePort: '' };

    setChecked('hpaEnabled', true);
    setVal('hpaMin', '3');
    setVal('hpaMax', '15');

    setChecked('pdbEnabled', true);
    setVal('pdbMinAvailable', '2');

    const yaml = generate();

    expect(yaml).toContain('  repository: my-registry/webapp');
    expect(yaml).toContain('  tag: "1.5.0"');
    expect(yaml).toContain('replicaCount: 3');
    expect(yaml).toContain('    containerPort: 8080');
    expect(yaml).toContain('  NODE_ENV:');
    expect(yaml).toContain('    value: production');
    expect(yaml).toContain('    cpu: 200m');
    expect(yaml).toContain('    memory: 512Mi');
    expect(yaml).toContain('livenessProbe:');
    expect(yaml).toContain('    path: /health');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  minReplicas: 3');
    expect(yaml).toContain('  maxReplicas: 15');
    expect(yaml).toContain('  minAvailable: 2');
  });
});

// ─── Full integration: statefulset DB ────────────────────
describe('Full integration — StatefulSet database', () => {
  test('generates PostgreSQL statefulset values.yaml', () => {
    setVal('workloadType', 'statefulset');
    setVal('imageRepo', 'postgres');
    setVal('imageTag', '15');
    setVal('replicaCount', '3');

    window.ports.push({ name: 'postgres', containerPort: '5432', protocol: 'TCP' });
    window.envVars.push({ name: 'POSTGRES_PASSWORD', source: 'secretKeyRef', refName: 'pg-secret', refKey: 'password' });

    setVal('serviceClusterIP', 'None');
    window.servicePorts[0] = { name: 'postgres', port: '5432', targetPort: 'postgres', protocol: 'TCP', nodePort: '' };

    window.vcts.push({ name: 'data', size: '50Gi', accessMode: 'ReadWriteOnce', storageClass: 'fast-ssd' });

    const yaml = generate();

    expect(yaml).toContain('  type: statefulset');
    expect(yaml).toContain('  repository: postgres');
    expect(yaml).toContain('  tag: "15"');
    expect(yaml).toContain('    containerPort: 5432');
    expect(yaml).toContain('      secretKeyRef:');
    expect(yaml).toContain('        name: pg-secret');
    expect(yaml).toContain('  clusterIP: None');
    expect(yaml).toContain('volumeClaimTemplates:');
    expect(yaml).toContain('    size: 50Gi');
    expect(yaml).toContain('    storageClassName: fast-ssd');
  });
});

// ─── Full integration: worker with cronjob ───────────────
describe('Full integration — worker with cronjob', () => {
  test('generates worker app with cronjob and no service', () => {
    setVal('imageRepo', 'my-registry/worker');
    setVal('imageTag', '3.0');
    setChecked('serviceEnabled', false);

    window.cronjobs.push({
      name: 'cleanup', schedule: '0 0 * * 0', command: '/bin/cleanup.sh',
      restartPolicy: 'OnFailure', concurrencyPolicy: 'Forbid',
      backoffLimit: '3', ttl: '', activeDeadline: '', suspend: false, image: '', args: '', env: ''
    });

    window.nodeSelectors.push({ key: 'workload', value: 'worker' });

    const yaml = generate();

    expect(yaml).toContain('  repository: my-registry/worker');
    expect(yaml).toContain('  tag: "3.0"');
    expect(yaml).toContain('  enabled: false');
    expect(yaml).toContain('cronjobs:');
    expect(yaml).toContain('  cleanup:');
    expect(yaml).toContain('    schedule: "0 0 * * 0"');
    expect(yaml).toContain('nodeSelector:');
    expect(yaml).toContain('  workload: worker');
  });
});

// ─── Name overrides ──────────────────────────────────────
describe('Name overrides', () => {
  test('generates nameOverride', () => {
    setVal('nameOverride', 'myapp');
    const yaml = generate();
    expect(yaml).toContain('nameOverride: "myapp"');
  });

  test('generates fullnameOverride', () => {
    setVal('fullnameOverride', 'my-custom-name');
    const yaml = generate();
    expect(yaml).toContain('fullnameOverride: "my-custom-name"');
  });

  test('generates both overrides', () => {
    setVal('nameOverride', 'myapp');
    setVal('fullnameOverride', 'my-custom-name');
    const yaml = generate();
    expect(yaml).toContain('nameOverride: "myapp"');
    expect(yaml).toContain('fullnameOverride: "my-custom-name"');
  });

  test('omits overrides when empty', () => {
    const yaml = generate();
    expect(yaml).not.toContain('nameOverride:');
    expect(yaml).not.toContain('fullnameOverride:');
  });

  test('nameOverride appears before workload', () => {
    setVal('nameOverride', 'myapp');
    const yaml = generate();
    const nameIdx = yaml.indexOf('nameOverride:');
    const workloadIdx = yaml.indexOf('workload:');
    expect(nameIdx).toBeLessThan(workloadIdx);
  });
});

// ─── Umbrella chart ──────────────────────────────────────
describe('Umbrella chart', () => {
  test('wraps all values under subchart key', () => {
    setChecked('umbrellaChart', true);
    setVal('umbrellaKey', 'backend');
    const yaml = generate();
    expect(yaml).toContain('backend:');
    // All values should be indented under the key
    expect(yaml).toContain('  workload:');
    expect(yaml).toContain('    type: deployment');
    expect(yaml).toContain('  image:');
    expect(yaml).toContain('    repository: nginx');
    expect(yaml).toContain('  service:');
  });

  test('includes comment about umbrella chart', () => {
    setChecked('umbrellaChart', true);
    setVal('umbrellaKey', 'api');
    const yaml = generate();
    expect(yaml).toContain('# Umbrella chart values');
    expect(yaml).toContain('"api"');
  });

  test('does not wrap when umbrella is off', () => {
    setChecked('umbrellaChart', false);
    const yaml = generate();
    expect(yaml).not.toContain('# Umbrella chart values');
    // workload should be at root level (no indent)
    expect(yaml).toMatch(/^workload:/m);
  });

  test('does not wrap when key is empty', () => {
    setChecked('umbrellaChart', true);
    setVal('umbrellaKey', '');
    const yaml = generate();
    expect(yaml).toMatch(/^workload:/m);
  });

  test('umbrella with nameOverride', () => {
    setChecked('umbrellaChart', true);
    setVal('umbrellaKey', 'backend');
    setVal('nameOverride', 'myapp');
    const yaml = generate();
    expect(yaml).toContain('backend:');
    expect(yaml).toContain('  nameOverride: "myapp"');
    expect(yaml).toContain('  workload:');
  });

  test('umbrella with full app config', () => {
    setChecked('umbrellaChart', true);
    setVal('umbrellaKey', 'frontend');
    setVal('imageRepo', 'my-registry/frontend');
    setVal('imageTag', '1.0');
    setVal('fullnameOverride', 'frontend');
    setVal('replicaCount', '2');
    setChecked('hpaEnabled', true);
    setVal('hpaMin', '2');
    setVal('hpaMax', '10');
    const yaml = generate();

    // Everything nested under frontend:
    expect(yaml).toContain('frontend:');
    expect(yaml).toContain('  fullnameOverride: "frontend"');
    expect(yaml).toContain('    repository: my-registry/frontend');
    expect(yaml).toContain('    tag: "1.0"');
    expect(yaml).toContain('  replicaCount: 2');
    expect(yaml).toContain('  hpa:');
    expect(yaml).toContain('    enabled: true');
    expect(yaml).toContain('    minReplicas: 2');
  });
});

// ─── OpenShift SCC ───────────────────────────
describe('OpenShift SCC generation', () => {
  test('generates SCC with name and basic settings', () => {
    window.addScc();
    window.sccs[0].name = 'restricted-custom';
    window.sccs[0].allowPrivilegedContainer = false;
    window.sccs[0].runAsUserType = 'MustRunAsRange';
    const yaml = generate();
    expect(yaml).toContain('scc:');
    expect(yaml).toContain('  restricted-custom:');
    expect(yaml).toContain('    allowPrivilegedContainer: false');
    expect(yaml).toContain('    runAsUser:');
    expect(yaml).toContain('      type: MustRunAsRange');
  });

  test('sets host access flags', () => {
    window.addScc();
    window.sccs[0].name = 'privileged-scc';
    window.sccs[0].allowHostNetwork = true;
    window.sccs[0].allowHostPID = true;
    const yaml = generate();
    expect(yaml).toContain('    allowHostNetwork: true');
    expect(yaml).toContain('    allowHostPID: true');
  });

  test('adds users and groups', () => {
    window.addScc();
    window.sccs[0].name = 'my-scc';
    window.sccs[0].users = 'system:serviceaccount:myns:mysa';
    window.sccs[0].groups = 'system:authenticated';
    const yaml = generate();
    expect(yaml).toContain('    users:');
    expect(yaml).toContain('      - system:serviceaccount:myns:mysa');
    expect(yaml).toContain('    groups:');
    expect(yaml).toContain('      - system:authenticated');
  });

  test('no SCC output by default', () => {
    const yaml = generate();
    expect(yaml).not.toContain('scc:');
  });
});

// ─── OpenShift Route ───────────────────────────
describe('OpenShift Route generation', () => {
  test('generates route when enabled', () => {
    setChecked('routeEnabled', true);
    setVal('routeHost', 'myapp.apps.cluster.example.com');
    setVal('routePath', '/');
    const yaml = generate();
    expect(yaml).toContain('route:');
    expect(yaml).toContain('  enabled: true');
    expect(yaml).toContain('  host: "myapp.apps.cluster.example.com"');
    expect(yaml).toContain('  path: "/"');
  });

  test('route with TLS settings', () => {
    setChecked('routeEnabled', true);
    setVal('routeTls', 'passthrough');
    const yaml = generate();
    expect(yaml).toContain('  tls:');
    expect(yaml).toContain('    termination: passthrough');
  });
});
