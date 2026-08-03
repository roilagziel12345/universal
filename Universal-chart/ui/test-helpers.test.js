const {
  yamlVal,
  esc,
  escHtml,
  isNum,
  parseValue,
  parseSimpleYaml,
  cleanK8sObject,
} = require('./test-helpers');

// ═══════════════════════════════════════════════════════════
// yamlVal — YAML value quoting
// ═══════════════════════════════════════════════════════════
describe('yamlVal', () => {
  test('empty string returns quoted empty', () => {
    expect(yamlVal('')).toBe('""');
  });

  test('undefined returns quoted empty', () => {
    expect(yamlVal(undefined)).toBe('""');
  });

  test('null returns quoted empty', () => {
    expect(yamlVal(null)).toBe('""');
  });

  test('boolean strings pass through unquoted', () => {
    expect(yamlVal('true')).toBe('true');
    expect(yamlVal('false')).toBe('false');
  });

  test('integers pass through unquoted', () => {
    expect(yamlVal('42')).toBe('42');
    expect(yamlVal('0')).toBe('0');
    expect(yamlVal('8080')).toBe('8080');
  });

  test('safe identifiers pass through unquoted', () => {
    expect(yamlVal('nginx')).toBe('nginx');
    expect(yamlVal('my-app')).toBe('my-app');
    expect(yamlVal('my/path')).toBe('my/path');
    expect(yamlVal('v1.2.3')).toBe('v1.2.3');
    expect(yamlVal('ClusterIP')).toBe('ClusterIP');
  });

  test('reserved words get quoted', () => {
    expect(yamlVal('null')).toBe('"null"');
    expect(yamlVal('yes')).toBe('"yes"');
    expect(yamlVal('no')).toBe('"no"');
  });

  test('values starting with digits get quoted (not pure integers)', () => {
    expect(yamlVal('3abc')).toBe('"3abc"');
  });

  test('strings with spaces get quoted', () => {
    expect(yamlVal('hello world')).toBe('"hello world"');
  });

  test('strings with special chars get quoted', () => {
    expect(yamlVal('key=value')).toBe('"key=value"');
    expect(yamlVal('a & b')).toBe('"a & b"');
  });

  test('escapes backslashes and double quotes', () => {
    expect(yamlVal('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlVal('path\\to')).toBe('"path\\\\to"');
  });
});

// ═══════════════════════════════════════════════════════════
// esc — HTML attribute escaping
// ═══════════════════════════════════════════════════════════
describe('esc', () => {
  test('escapes double quotes', () => {
    expect(esc('say "hi"')).toBe('say &quot;hi&quot;');
  });

  test('handles null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  test('passes through normal strings', () => {
    expect(esc('hello')).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════
// escHtml — HTML entity escaping
// ═══════════════════════════════════════════════════════════
describe('escHtml', () => {
  test('escapes ampersand', () => {
    expect(escHtml('a & b')).toBe('a &amp; b');
  });

  test('escapes angle brackets', () => {
    expect(escHtml('<div>')).toBe('&lt;div&gt;');
  });

  test('escapes all together', () => {
    expect(escHtml('x < y & y > z')).toBe('x &lt; y &amp; y &gt; z');
  });

  test('passes through safe strings', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });
});

// ═══════════════════════════════════════════════════════════
// isNum — numeric string check
// ═══════════════════════════════════════════════════════════
describe('isNum', () => {
  test('recognizes integers', () => {
    expect(isNum('42')).toBe(true);
    expect(isNum('0')).toBe(true);
    expect(isNum('100')).toBe(true);
  });

  test('rejects non-integers', () => {
    expect(isNum('3.14')).toBe(false);
    expect(isNum('abc')).toBe(false);
    expect(isNum('42abc')).toBe(false);
    expect(isNum('')).toBe(false);
    expect(isNum('100m')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// parseValue — string to typed value
// ═══════════════════════════════════════════════════════════
describe('parseValue', () => {
  test('parses booleans', () => {
    expect(parseValue('true')).toBe(true);
    expect(parseValue('false')).toBe(false);
  });

  test('parses integers', () => {
    expect(parseValue('42')).toBe(42);
    expect(parseValue('0')).toBe(0);
  });

  test('strips double quotes', () => {
    expect(parseValue('"hello"')).toBe('hello');
  });

  test('strips single quotes', () => {
    expect(parseValue("'hello'")).toBe('hello');
  });

  test('returns empty string for null/tilde', () => {
    expect(parseValue(null)).toBe('');
    expect(parseValue('~')).toBe('');
    expect(parseValue('null')).toBe('');
  });

  test('passes through plain strings', () => {
    expect(parseValue('nginx')).toBe('nginx');
    expect(parseValue('100m')).toBe('100m');
  });
});

// ═══════════════════════════════════════════════════════════
// parseSimpleYaml — minimal YAML parser
// ═══════════════════════════════════════════════════════════
describe('parseSimpleYaml', () => {
  test('parses simple key-value pairs', () => {
    const result = parseSimpleYaml('name: test\nversion: 1');
    expect(result.name).toBe('test');
    expect(result.version).toBe(1);
  });

  test('parses nested objects', () => {
    const yaml = `image:
  repository: nginx
  tag: "1.0"
  pullPolicy: IfNotPresent`;
    const result = parseSimpleYaml(yaml);
    expect(result.image.repository).toBe('nginx');
    expect(result.image.tag).toBe('1.0');
    expect(result.image.pullPolicy).toBe('IfNotPresent');
  });

  test('parses arrays', () => {
    const yaml = `ports:
  - name: http
    containerPort: 8080
  - name: grpc
    containerPort: 9090`;
    const result = parseSimpleYaml(yaml);
    expect(result.ports).toHaveLength(2);
    expect(result.ports[0].name).toBe('http');
    expect(result.ports[0].containerPort).toBe(8080);
    expect(result.ports[1].name).toBe('grpc');
  });

  test('parses inline arrays', () => {
    const yaml = 'accessModes: [ReadWriteOnce, ReadWriteMany]';
    const result = parseSimpleYaml(yaml);
    expect(result.accessModes).toEqual(['ReadWriteOnce', 'ReadWriteMany']);
  });

  test('parses boolean values', () => {
    const yaml = `service:
  enabled: true
hpa:
  enabled: false`;
    const result = parseSimpleYaml(yaml);
    expect(result.service.enabled).toBe(true);
    expect(result.hpa.enabled).toBe(false);
  });

  test('parses empty objects', () => {
    const result = parseSimpleYaml('resources: {}');
    expect(result.resources).toEqual({});
  });

  test('skips comments', () => {
    const yaml = `# this is a comment
name: test
# another comment
version: 1`;
    const result = parseSimpleYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.version).toBe(1);
  });

  test('skips empty lines', () => {
    const yaml = `name: test

version: 1`;
    const result = parseSimpleYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.version).toBe(1);
  });

  test('parses workload config', () => {
    const yaml = `workload:
  type: deployment
replicaCount: 3
revisionHistoryLimit: 5`;
    const result = parseSimpleYaml(yaml);
    expect(result.workload.type).toBe('deployment');
    expect(result.replicaCount).toBe(3);
    expect(result.revisionHistoryLimit).toBe(5);
  });

  test('parses service config', () => {
    const yaml = `service:
  enabled: true
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP`;
    const result = parseSimpleYaml(yaml);
    expect(result.service.enabled).toBe(true);
    expect(result.service.type).toBe('ClusterIP');
    expect(result.service.ports).toHaveLength(1);
    expect(result.service.ports[0].port).toBe(80);
  });

  test('parses env vars with valueFrom', () => {
    const yaml = `env:
  - name: MY_VAR
    value: hello
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name`;
    const result = parseSimpleYaml(yaml);
    expect(result.env).toHaveLength(2);
    expect(result.env[0].name).toBe('MY_VAR');
    expect(result.env[0].value).toBe('hello');
    expect(result.env[1].name).toBe('POD_NAME');
    expect(result.env[1].valueFrom.fieldRef.fieldPath).toBe('metadata.name');
  });

  test('parses configMaps', () => {
    const yaml = `configMaps:
  - name: app-config
    data:
      LOG_LEVEL: info
      DB_HOST: postgres`;
    const result = parseSimpleYaml(yaml);
    expect(result.configMaps).toHaveLength(1);
    expect(result.configMaps[0].name).toBe('app-config');
    expect(result.configMaps[0].data.LOG_LEVEL).toBe('info');
  });

  test('parses secrets', () => {
    const yaml = `secrets:
  - name: app-secret
    type: Opaque
    stringData:
      DB_PASSWORD: secret123`;
    const result = parseSimpleYaml(yaml);
    expect(result.secrets[0].name).toBe('app-secret');
    expect(result.secrets[0].type).toBe('Opaque');
    expect(result.secrets[0].stringData.DB_PASSWORD).toBe('secret123');
  });

  test('parses PVC config', () => {
    const yaml = `pvc:
  - name: my-data
    accessModes: [ReadWriteOnce]
    size: 10Gi
    storageClassName: fast-ssd`;
    const result = parseSimpleYaml(yaml);
    expect(result.pvc[0].name).toBe('my-data');
    expect(result.pvc[0].accessModes).toEqual(['ReadWriteOnce']);
    expect(result.pvc[0].size).toBe('10Gi');
    expect(result.pvc[0].storageClassName).toBe('fast-ssd');
  });

  test('parses HPA config', () => {
    const yaml = `hpa:
  enabled: true
  minReplicas: 2
  maxReplicas: 10`;
    const result = parseSimpleYaml(yaml);
    expect(result.hpa.enabled).toBe(true);
    expect(result.hpa.minReplicas).toBe(2);
    expect(result.hpa.maxReplicas).toBe(10);
  });

  test('parses RBAC config', () => {
    const yaml = `rbac:
  roles:
    - name: my-role
      rules:
        - apiGroups:
            - ""
          resources:
            - pods
          verbs:
            - get
            - list`;
    const result = parseSimpleYaml(yaml);
    expect(result.rbac.roles).toHaveLength(1);
    expect(result.rbac.roles[0].name).toBe('my-role');
  });

  test('parses route config', () => {
    const yaml = `route:
  enabled: true
  host: myapp.apps.cluster.example.com
  tls:
    termination: edge`;
    const result = parseSimpleYaml(yaml);
    expect(result.route.enabled).toBe(true);
    expect(result.route.host).toBe('myapp.apps.cluster.example.com');
    expect(result.route.tls.termination).toBe('edge');
  });

  test('parses multiline string (pipe)', () => {
    const yaml = `data:
  config: |
    key1=value1
    key2=value2`;
    const result = parseSimpleYaml(yaml);
    expect(result.data.config).toContain('key1=value1');
  });

  test('parses complex nested structure', () => {
    const yaml = `workload:
  type: statefulset
image:
  repository: postgres
  tag: "15"
replicaCount: 3
service:
  enabled: true
  type: ClusterIP
  clusterIP: None
  ports:
    - name: postgres
      port: 5432
      targetPort: postgres
volumeClaimTemplates:
  - name: data
    accessModes: [ReadWriteOnce]
    size: 50Gi`;
    const result = parseSimpleYaml(yaml);
    expect(result.workload.type).toBe('statefulset');
    expect(result.image.repository).toBe('postgres');
    expect(result.replicaCount).toBe(3);
    expect(result.service.clusterIP).toBe('None');
    expect(result.volumeClaimTemplates[0].size).toBe('50Gi');
  });
});

// ═══════════════════════════════════════════════════════════
// cleanK8sObject — strip runtime fields
// ═══════════════════════════════════════════════════════════
describe('cleanK8sObject', () => {
  test('removes status field', () => {
    const obj = { metadata: { name: 'test' }, status: { replicas: 1 } };
    const result = cleanK8sObject(obj);
    expect(result.status).toBeUndefined();
    expect(result.metadata.name).toBe('test');
  });

  test('removes runtime metadata fields', () => {
    const obj = {
      metadata: {
        name: 'test',
        resourceVersion: '12345',
        uid: 'abc-123',
        creationTimestamp: '2024-01-01',
        generation: 1,
        managedFields: [],
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.metadata.name).toBe('test');
    expect(result.metadata.resourceVersion).toBeUndefined();
    expect(result.metadata.uid).toBeUndefined();
    expect(result.metadata.creationTimestamp).toBeUndefined();
    expect(result.metadata.generation).toBeUndefined();
    expect(result.metadata.managedFields).toBeUndefined();
  });

  test('removes runtime annotations', () => {
    const obj = {
      metadata: {
        name: 'test',
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration': '{}',
          'deployment.kubernetes.io/revision': '1',
          'my-custom-annotation': 'keep-me',
        },
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.metadata.annotations['my-custom-annotation']).toBe('keep-me');
    expect(result.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration']).toBeUndefined();
    expect(result.metadata.annotations['deployment.kubernetes.io/revision']).toBeUndefined();
  });

  test('removes empty annotations object', () => {
    const obj = {
      metadata: {
        name: 'test',
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration': '{}',
        },
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.metadata.annotations).toBeUndefined();
  });

  test('removes runtime labels', () => {
    const obj = {
      metadata: {
        name: 'test',
        labels: {
          'pod-template-hash': 'abc123',
          app: 'myapp',
        },
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.metadata.labels.app).toBe('myapp');
    expect(result.metadata.labels['pod-template-hash']).toBeUndefined();
  });

  test('removes default terminationGracePeriodSeconds', () => {
    const obj = {
      metadata: { name: 'test' },
      spec: {
        template: {
          spec: {
            terminationGracePeriodSeconds: 30,
            containers: [],
          },
        },
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.spec.template.spec.terminationGracePeriodSeconds).toBeUndefined();
  });

  test('keeps non-default terminationGracePeriodSeconds', () => {
    const obj = {
      metadata: { name: 'test' },
      spec: {
        template: {
          spec: {
            terminationGracePeriodSeconds: 60,
            containers: [],
          },
        },
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.spec.template.spec.terminationGracePeriodSeconds).toBe(60);
  });

  test('removes default dnsPolicy', () => {
    const obj = {
      metadata: { name: 'test' },
      spec: {
        template: {
          spec: {
            dnsPolicy: 'ClusterFirst',
            containers: [],
          },
        },
      },
    };
    const result = cleanK8sObject(obj);
    expect(result.spec.template.spec.dnsPolicy).toBeUndefined();
  });

  test('handles null/undefined input', () => {
    expect(cleanK8sObject(null)).toBeNull();
    expect(cleanK8sObject(undefined)).toBeUndefined();
  });

  test('handles object without metadata', () => {
    const obj = { data: { key: 'value' } };
    const result = cleanK8sObject(obj);
    expect(result.data.key).toBe('value');
  });
});

// ═══════════════════════════════════════════════════════════
// Integration-style tests — parse real chart values
// ═══════════════════════════════════════════════════════════
describe('parseSimpleYaml - real chart values', () => {
  test('parses full webapp config', () => {
    const yaml = `workload:
  type: deployment

image:
  repository: my-registry/myapp
  tag: "1.0.0"
  pullPolicy: IfNotPresent

replicaCount: 2

ports:
  - name: http
    containerPort: 8080
    protocol: TCP

env:
  - name: DB_HOST
    value: postgres
  - name: LOG_LEVEL
    value: info

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

service:
  enabled: true
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http

ingress:
  enabled: false

serviceAccount:
  create: true
  automountServiceAccountToken: true`;

    const result = parseSimpleYaml(yaml);
    expect(result.workload.type).toBe('deployment');
    expect(result.image.repository).toBe('my-registry/myapp');
    expect(result.image.tag).toBe('1.0.0');
    expect(result.replicaCount).toBe(2);
    expect(result.ports).toHaveLength(1);
    expect(result.env).toHaveLength(2);
    expect(result.resources.requests.cpu).toBe('100m');
    expect(result.resources.limits.memory).toBe('256Mi');
    expect(result.service.enabled).toBe(true);
    expect(result.ingress.enabled).toBe(false);
    expect(result.serviceAccount.create).toBe(true);
  });

  test('parses cronjob config', () => {
    const yaml = `cronjobs:
  - name: backup
    schedule: "0 2 * * *"
    concurrencyPolicy: Forbid
    jobTemplate:
      backoffLimit: 3
      restartPolicy: OnFailure
      command:
        - /bin/backup.sh
  - name: cleanup
    schedule: "0 0 * * 0"
    jobTemplate:
      command:
        - /bin/cleanup.sh`;

    const result = parseSimpleYaml(yaml);
    expect(result.cronjobs).toHaveLength(2);
    expect(result.cronjobs[0].name).toBe('backup');
    expect(result.cronjobs[0].schedule).toBe('0 2 * * *');
    expect(result.cronjobs[0].jobTemplate.backoffLimit).toBe(3);
  });

  test('parses networkPolicies config', () => {
    const yaml = `networkPolicies:
  - name: allow-ingress
    podSelector: {}
    policyTypes: [Ingress, Egress]
    ingress:
      - from:
          - podSelector:
              matchLabels:
                app: frontend`;

    const result = parseSimpleYaml(yaml);
    expect(result.networkPolicies).toHaveLength(1);
    expect(result.networkPolicies[0].name).toBe('allow-ingress');
    expect(result.networkPolicies[0].policyTypes).toEqual(['Ingress', 'Egress']);
  });
});
