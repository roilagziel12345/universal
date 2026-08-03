# universal-chart

A generic, modular Helm chart for deploying any application to Kubernetes or OpenShift.
All configuration is handled through values.yaml — no app-specific templates required.

In my workflow, I publish this chart to ChartMuseum and reference it from my application’s Chart.yaml as a dependency (an umbrella chart setup is also an option (charts/).
---

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [UI — values.yaml Generator](#ui--valuesyaml-generator)
  - [How to Open](#how-to-open)
  - [Features](#features)
  - [Import from Existing Manifests](#import-from-existing-manifests)
  - [Multi-Environment (GitOps) Mode](#multi-environment-gitops-mode)
- [Tests](#tests)
  - [UI Tests (Jest)](#ui-tests-jest)
  - [Helm Chart Tests (helm-unittest)](#helm-chart-tests-helm-unittest)
- [Workload Types](#workload-types)
- [Key Features Reference](#key-features-reference)
- [Example values.yaml Templates](#example-valuesyaml-templates)
- [GitOps / ArgoCD Pattern](#gitops--argocd-pattern)
- [Chart Validation](#chart-validation)
- [Examples Directory](#examples-directory)

---

## Overview

`universal-chart` is a single Helm chart that can deploy any application workload without writing custom templates. Everything is driven by `values.yaml`:

- Choose **Deployment**, **StatefulSet**, or **DaemonSet**
- Add sidecars, init containers, ConfigMaps, Secrets, PVCs — all from values
- Built-in support for HPA, VPA, PDB, RBAC, NetworkPolicies, CronJobs, Jobs
- Works on both plain **Kubernetes** and **OpenShift** (Route and SCC support)
- Comes with a **browser-based UI** to visually generate your `values.yaml`
- Full **Helm unit test** suite (`tests/`) and **UI Jest test** suite (`ui/`)

---

## Project Structure

```
universal-chart/
├── Chart.yaml                        # Chart metadata (name, version)
├── values.yaml                       # Full defaults — every option documented
├── values.schema.json                # JSON Schema validation for values
├── COOKBOOK.md                       # Detailed recipes for every feature
│
├── templates/                        # Helm templates
│   ├── _helpers.tpl                  # Name / label / checksum helpers
│   ├── _pod-spec.tpl                 # Shared pod spec (DRY across workloads)
│   ├── deployment.yaml               # workload.type: deployment
│   ├── statefulset.yaml              # workload.type: statefulset
│   ├── daemonset.yaml                # workload.type: daemonset
│   ├── service.yaml
│   ├── services.yaml                 # loops over .Values.services (extra Services)
│   ├── ingress.yaml
│   ├── route.yaml                    # OpenShift Route
│   ├── routes.yaml                   # loops over .Values.routes (extra OpenShift Routes)
│   ├── scc.yaml                      # OpenShift SecurityContextConstraints
│   ├── configmap.yaml                # loops over .Values.configMaps
│   ├── secret.yaml                   # loops over .Values.secrets
│   ├── pvc.yaml                      # loops over .Values.pvc
│   ├── pv.yaml                       # loops over .Values.persistentVolumes
│   ├── storageclass.yaml             # loops over .Values.storageClasses
│   ├── serviceaccount.yaml
│   ├── hpa.yaml
│   ├── vpa.yaml
│   ├── pdb.yaml
│   ├── networkpolicy.yaml            # loops over .Values.networkPolicies
│   ├── rbac.yaml                     # Role, RoleBinding, ClusterRole, CRB
│   ├── cronjob.yaml                  # loops over .Values.cronjobs
│   ├── job.yaml                      # loops over .Values.jobs
│   ├── servicemonitor.yaml           # Prometheus ServiceMonitor
│   └── extra-deploy.yaml             # Raw YAML injection via tpl
│
├── tests/                            # Helm unit tests (helm-unittest plugin)
│   ├── deployment_test.yaml
│   ├── statefulset_test.yaml
│   ├── daemonset_test.yaml
│   ├── service_test.yaml
│   ├── ingress_test.yaml
│   ├── configmap_test.yaml
│   ├── secret_test.yaml
│   ├── hpa_test.yaml
│   ├── vpa_test.yaml
│   ├── pdb_test.yaml
│   ├── cronjob_test.yaml
│   ├── job_test.yaml
│   ├── rbac_test.yaml
│   ├── networkpolicy_test.yaml
│   ├── pvc_test.yaml
│   ├── pv_test.yaml
│   ├── storageclass_test.yaml
│   ├── route_test.yaml
│   ├── routes_test.yaml
│   ├── services_test.yaml
│   ├── serviceaccount_test.yaml
│   ├── scc_test.yaml
│   ├── servicemonitor_test.yaml
│   ├── extra_deploy_test.yaml
│   └── validation_test.yaml
│
├── ui/                               # Browser-based values.yaml generator
│   ├── index.html                    # Single-file UI app (open in browser)
│   ├── package.json                  # Jest test runner config
│   ├── test-helpers.js               # Pure utility functions (no DOM)
│   ├── test-helpers.test.js          # Unit tests for utility functions
│   ├── generate.test.js              # Tests for YAML generation logic
│   └── environments.test.js          # Tests for multi-env / GitOps features
│
└── examples/
    ├── simple-webapp.yaml            # Minimal deployment example
    ├── full-example.yaml             # Everything-on example (all features)
    ├── app1-fullstack-webapp.yaml    # Full-stack app with Ingress, HPA, secrets
    ├── app2-postgres-statefulset.yaml# StatefulSet with PVCs, probes, RBAC
    ├── 3-apps-usage.yaml             # 3-app ArgoCD ApplicationSet pattern
    └── gitops/                       # Ready-to-use GitOps repo structure
        ├── applicationset.yaml       # ArgoCD ApplicationSet
        ├── STRUCTURE.md              # GitOps layout explanation
        ├── _base/                    # Shared base values
        └── env/                      # Per-environment overrides
```

---

## Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| `helm` ≥ 3.10 | Deploy the chart | [helm.sh](https://helm.sh/docs/intro/install/) |
| `helm-unittest` plugin | Run `tests/` | See below |
| `node` ≥ 18 + `npm` | Run `ui/` Jest tests | [nodejs.org](https://nodejs.org) |
| A browser | Open `ui/index.html` | Any modern browser |

**Install helm-unittest plugin:**

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest
```

---

## Quick Start

### Deploy with defaults (nginx)

```bash
helm install my-release . 
```

### Deploy with your own values

```bash
helm install my-app . -f my-values.yaml
```

### Minimal `values.yaml` for a web app

```yaml
image:
  repository: my-registry/myapp
  tag: "1.0.0"

ports:
  http:
    containerPort: 8080

service:
  enabled: true
  ports:
    http:
      port: 80
      targetPort: http

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: myapp.example.com
      paths:
        - path: /
          pathType: Prefix
```

---

## UI — values.yaml Generator

The `ui/index.html` is a **standalone, zero-dependency browser app** that generates a complete `values.yaml` for this chart.
No server, no build step — just open the file.

### How to Open

**Option A — Double-click**

```
Open ui/index.html directly in your browser (Chrome, Firefox, Edge, etc.)
```

**Option B — Local HTTP server (recommended, avoids browser file:// restrictions)**

```bash
# Using Python
cd ui
python -m http.server 8080
# Then open: http://localhost:8080

# Using Node.js npx
npx serve ui
# Then open the printed URL
```

### Features

The UI covers every chart feature via a form:

| Section | What you configure |
|---|---|
| **Workload** | Type (Deployment/StatefulSet/DaemonSet), replicas, strategy, name overrides |
| **Image** | Repository, tag, pull policy, image pull secrets |
| **Ports** | Container ports (name, port, protocol, hostPort) |
| **Environment** | Literal values, ConfigMap refs, Secret refs, fieldRef, envFrom |
| **Resources** | CPU/memory requests and limits |
| **Probes** | Liveness, readiness, startup (httpGet, tcpSocket, exec) |
| **Security** | Pod security context, container security context, capabilities |
| **Lifecycle** | postStart / preStop exec hooks |
| **Volumes** | VolumeMounts, volumes (emptyDir, PVC, ConfigMap, Secret) |
| **Sidecars** | Extra containers alongside main container |
| **Init containers** | Run-before-main containers |
| **Service** | Type, ports, annotations |
| **Ingress** | Hosts, paths, TLS, className, annotations |
| **OpenShift Route** | Host, path, TLS termination |
| **OpenShift SCC** | SecurityContextConstraints (privileges, strategies, etc.) |
| **ConfigMaps** | Key-value data, multi-line files |
| **Secrets** | Opaque, TLS, Docker registry secrets |
| **PVC / PV** | Storage claims and persistent volumes |
| **StatefulSet VCTs** | volumeClaimTemplates per-pod storage |
| **HPA** | Min/max replicas, CPU/memory targets |
| **VPA** | Vertical autoscaler update mode |
| **PDB** | Pod disruption budget |
| **RBAC** | Roles, RoleBindings, ClusterRoles |
| **NetworkPolicies** | Ingress/egress rules |
| **CronJobs** | Scheduled jobs with cron expressions |
| **Jobs** | One-off jobs (e.g. DB migrations) |
| **ServiceMonitor** | Prometheus scraping config |
| **Scheduling** | nodeSelector, tolerations, affinity, topology spread |
| **Advanced** | hostNetwork, DNS, graceful shutdown, priority class |
| **extraDeploy** | Raw YAML injection for CRDs or anything else |

Once configured, click **Generate** — the YAML output appears on the right, ready to copy or download.

### Import from Existing Manifests

The UI can **import your existing kubectl YAML** and convert it to chart values:

1. Click the **Import** button (or paste area) at the top of the UI
2. Paste your raw Kubernetes YAML (Deployment, StatefulSet, Service, etc.)
3. Multiple resources separated by `---` are all parsed at once
4. The form pre-fills with the imported values
5. Click **Generate** to produce the equivalent `values.yaml`

This is useful for migrating existing workloads to the chart.

### Multi-Environment (GitOps) Mode

The UI supports a **base + per-environment override** model, designed for GitOps workflows:

1. Configure your **base** values as normal (shown in the main form)
2. Click **+ Add Environment** — enter a name (e.g. `dev`, `staging`, `prod`)
3. Switch to the environment tab
4. Click **+ Add Override** and select which sections differ in that environment
5. Modify only those sections — everything else inherits from base
6. The YAML output switches to **override-only** YAML (environment comment header + only overridden sections)
7. Click **Download GitOps Zip** to get a ready-to-use directory structure:

```
values.yaml            ← base values
envs/
  dev/
    values.yaml        ← dev overrides only
  staging/
    values.yaml        ← staging overrides only
  prod/
    values.yaml        ← prod overrides only
```

This maps directly to how ArgoCD ApplicationSets layer values files.

---

## Tests

The project has **two separate test suites** for different purposes.

---

### UI Tests (Jest)

Located in `ui/`, these test the JavaScript logic inside `index.html` using [Jest](https://jestjs.io/) and [jsdom](https://github.com/jsdom/jsdom).

#### Setup & Run

```bash
cd ui
npm install      # install Jest + jsdom (first time only)
npm test         # run all tests with verbose output
```

#### Test Files

| File | What it tests |
|---|---|
| `generate.test.js` | Core YAML generation — every form field, all workload types, probes, security contexts, import logic, `parseSimpleYaml` parser |
| `environments.test.js` | Multi-environment feature — adding/removing/switching envs, section overrides, env YAML generation, GitOps zip creation |
| `test-helpers.test.js` | Pure utility functions — `yamlVal`, `parseValue`, `parseSimpleYaml`, `cleanK8sObject`, HTML escaping |

#### How the UI Tests Work

The tests load `index.html` into a jsdom virtual browser environment:

```js
const html = fs.readFileSync('index.html', 'utf-8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
```

Then they:
1. **Set form field values** via `document.getElementById('fieldId').value = 'value'`
2. **Call `window.generate()`** to trigger YAML generation
3. **Assert on `yaml-output` text content** to verify the correct YAML was produced

Example test:
```js
test('sets CPU and memory requests', () => {
  setVal('reqCpu', '100m');
  setVal('reqMem', '128Mi');
  const yaml = generate();
  expect(yaml).toContain('    cpu: 100m');
  expect(yaml).toContain('    memory: 128Mi');
});
```

#### Test Coverage Areas

`generate.test.js` covers:
- Default YAML output (workload, image, service, serviceAccount, securityContext)
- Workload types (deployment, statefulset, daemonset)
- Image configuration (repo, tag, pull policy, pull secrets)
- Replicas and update strategy (RollingUpdate, Recreate)
- Container ports (single, multiple, hostPort)
- Environment variables (literal, configMapKeyRef, secretKeyRef, fieldRef, envFrom)
- Resource requests and limits
- Liveness, readiness, and startup probes (httpGet, tcpSocket, exec)
- Lifecycle hooks (postStart, preStop)
- Security contexts (pod-level vs. container-level separation)
- StatefulSet security context import edge cases
- Service configuration (type, ports, disabled)
- Ingress configuration (hosts, TLS, annotations)
- OpenShift Route
- ConfigMaps, Secrets
- HPA and VPA
- PDB
- RBAC (roles, clusterRoles)
- CronJobs
- Jobs
- NetworkPolicies
- Sidecars, init containers
- Volumes and volumeMounts
- StatefulSet volumeClaimTemplates
- Scheduling (nodeSelector, tolerations, affinity, topology spread)
- Import from existing Kubernetes manifests (Deployment, StatefulSet, Service)
- `parseSimpleYaml` block scalar (`|`) support

`environments.test.js` covers:
- Data model (environments array, section mapping completeness)
- Adding / removing / switching environments
- Section overrides (add, remove, restore base values)
- UI state (env-mode class, override bar, tabs, GitOps zip button)
- Environment YAML generation (only overridden sections, comment header)
- Zip file creation (valid PK header, correct file count via EOCD)
- `generateEnvOnlyYaml` function
- Environment renaming via inline input
- Multi-app support

`test-helpers.test.js` covers:
- `yamlVal` — YAML value quoting rules (integers, booleans, reserved words, special chars)
- `esc` / `escHtml` — HTML entity escaping
- `isNum` — numeric string detection
- `parseValue` — string-to-typed-value conversion
- `parseSimpleYaml` — minimal YAML parser (objects, arrays, inline arrays, block scalars, booleans, nulls)
- `cleanK8sObject` — stripping runtime metadata fields from imported manifests

---

### Helm Chart Tests (helm-unittest)

Located in `tests/`, these are [helm-unittest](https://github.com/helm-unittest/helm-unittest) YAML test files that validate each Helm template produces correct Kubernetes manifests.

#### Setup

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest
```

#### Run

```bash
# Run all helm unit tests
helm unittest .

# Run a specific test file
helm unittest . -f tests/deployment_test.yaml

# Run with verbose output
helm unittest . --color --debug
```

#### Test Files Overview

| File | Tests |
|---|---|
| `deployment_test.yaml` | Deployment rendering, replicas, strategy, image, env, ports, probes, security, volumes, sidecars, HPA interaction, name overrides |
| `statefulset_test.yaml` | StatefulSet specifics — serviceName, volumeClaimTemplates, podManagementPolicy, updateStrategy |
| `daemonset_test.yaml` | DaemonSet — no replicas, correct kind only when type=daemonset |
| `service_test.yaml` | Service enabled/disabled, type (ClusterIP/NodePort/LB), ports, annotations |
| `services_test.yaml` | Extra map-based Services (`.Values.services`) — one Service per enabled entry, type, ports, selector |
| `ingress_test.yaml` | Ingress hosts, TLS, className, annotations |
| `configmap_test.yaml` | ConfigMap creation from map-based values |
| `secret_test.yaml` | Secret creation, type override |
| `hpa_test.yaml` | HPA enabled/disabled, min/max replicas, metrics |
| `vpa_test.yaml` | VPA enabled/disabled, update mode |
| `pdb_test.yaml` | PDB minAvailable / maxUnavailable |
| `cronjob_test.yaml` | CronJob schedule, concurrencyPolicy, job template |
| `job_test.yaml` | Job backoffLimit, restartPolicy, annotations (ArgoCD hooks) |
| `rbac_test.yaml` | Role, RoleBinding, ClusterRole, ClusterRoleBinding creation |
| `networkpolicy_test.yaml` | NetworkPolicy podSelector, policyTypes, ingress/egress rules |
| `pvc_test.yaml` | PVC accessModes, storage size, storageClassName |
| `pv_test.yaml` | PersistentVolume capacity, access modes, reclaim policy |
| `storageclass_test.yaml` | StorageClass provisioner, parameters |
| `route_test.yaml` | OpenShift Route host, TLS termination, targetPort |
| `routes_test.yaml` | Extra map-based OpenShift Routes (`.Values.routes`) — one Route per enabled entry, serviceName, TLS, wildcardPolicy |
| `serviceaccount_test.yaml` | ServiceAccount create/skip, annotations, automount token |
| `servicemonitor_test.yaml` | Prometheus ServiceMonitor path, port, interval |
| `extra_deploy_test.yaml` | Raw YAML injection via `extraDeploy[]` |
| `validation_test.yaml` | JSON Schema validation errors on invalid values |

#### Example Test Structure

Each test file follows the `helm-unittest` format:

```yaml
suite: Deployment
templates:
  - templates/deployment.yaml
tests:
  - it: should set custom replica count
    set:
      replicaCount: 5
    asserts:
      - equal:
          path: spec.replicas
          value: 5

  - it: should omit replicas when HPA is enabled
    set:
      hpa.enabled: true
    asserts:
      - isNull:
          path: spec.replicas
```

---

## Workload Types

```yaml
workload:
  type: deployment    # deployment | statefulset | daemonset | none
```

| Type | Use case |
|---|---|
| `deployment` | Stateless apps (APIs, frontends, workers) — default |
| `statefulset` | Databases, message queues, anything needing stable identity or PVC-per-pod |
| `daemonset` | Node-level agents (log shippers, monitoring, CNI plugins) |
| `none` | Config/RBAC-only releases with no compute workload (ServiceAccounts, Roles, ConfigMaps, a namespace-shared bundle, etc.) — renders no Deployment/StatefulSet/DaemonSet at all. `hpa`, `vpa`, and `pdb` all fail validation when combined with `none`, since there are no pods to scale, resize, or protect. |

---

## Key Features Reference

| Feature | Values Key | Notes |
|---|---|---|
| Workload type | `workload.type` | deployment / statefulset / daemonset / none (no compute workload) |
| Replica count | `replicaCount` | Omitted automatically when HPA is enabled |
| Update strategy | `strategy` | RollingUpdate / Recreate / OnDelete |
| Sidecar containers | `sidecars` | Map-keyed by container name |
| Init containers | `initContainers` | Map-keyed by container name |
| Multiple ConfigMaps | `configMaps` | Map-keyed by ConfigMap name |
| Multiple Secrets | `secrets` | Map-keyed by Secret name |
| Multiple PVCs | `pvc` | Map-keyed by PVC name |
| StatefulSet PVC templates | `volumeClaimTemplates` | Persistent storage per replica |
| Multiple NetworkPolicies | `networkPolicies` | Map-keyed by policy name |
| CronJobs | `cronjobs` | Map-keyed by job name |
| One-off Jobs | `jobs` | Map-keyed by job name |
| RBAC | `rbac.roles`, `rbac.clusterRoles` | Auto-bindings created |
| HPA | `hpa.enabled: true` | Removes `spec.replicas` from workload; unsupported with `workload.type: none`/`daemonset` |
| VPA | `vpa.enabled: true` | Auto-scaling of CPU/memory; unsupported with `workload.type: none` |
| PodDisruptionBudget | `pdb.enabled: true` | Min available or max unavailable; unsupported with `workload.type: none` |
| Prometheus scraping | `serviceMonitor.enabled: true` | Requires Prometheus CRDs |
| OpenShift Route | `route.enabled: true` | Alternative to Ingress |
| Extra Services | `services` | Map-keyed by Service name, beyond the primary `service` |
| Extra OpenShift Routes | `routes` | Map-keyed by Route name, beyond the primary `route` |
| Pod anti-affinity | `affinity.podAntiAffinity` | Soft or hard node spread |
| Topology spread | `topologySpreadConstraints[]` | Fine-grained scheduling |
| Auto-restart on CM/Secret change | `checksums.enabled: true` | Rolling restart via annotations |
| Raw YAML injection | `extraDeploy[]` | Any CRD or custom resource |

---

## Example values.yaml Templates

### Simple Web App

```yaml
image:
  repository: my-registry/myapp
  tag: "1.0.0"

replicaCount: 2

ports:
  http:
    containerPort: 8080

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

service:
  enabled: true
  ports:
    http:
      port: 80
      targetPort: http

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: myapp.example.com
      paths:
        - path: /
          pathType: Prefix
```

### StatefulSet (e.g. PostgreSQL)

```yaml
workload:
  type: statefulset

image:
  repository: postgres
  tag: "15"

replicaCount: 1

ports:
  postgres:
    containerPort: 5432

env:
  POSTGRES_USER:
    valueFrom:
      secretKeyRef:
        name: postgres-secret
        key: username
  POSTGRES_PASSWORD:
    valueFrom:
      secretKeyRef:
        name: postgres-secret
        key: password

service:
  enabled: true
  clusterIP: None     # Headless service for StatefulSet
  ports:
    postgres:
      port: 5432
      targetPort: postgres

volumeClaimTemplates:
  data:
    accessModes: [ReadWriteOnce]
    size: 20Gi
    storageClassName: fast-ssd

volumeMounts:
  data:
    mountPath: /var/lib/postgresql/data
    subPath: pgdata

livenessProbe:
  exec:
    command: ["pg_isready", "-U", "postgres"]
  initialDelaySeconds: 30
  periodSeconds: 10
```

### DaemonSet (e.g. Log Shipper)

```yaml
workload:
  type: daemonset

image:
  repository: fluent/fluent-bit
  tag: "3.0"

tolerations:
  - operator: Exists

volumeMounts:
  varlog:
    mountPath: /var/log
    readOnly: true

volumes:
  varlog:
    hostPath:
      path: /var/log
```

### Config/RBAC-only release (no compute workload)

For a namespace-shared bundle of ConfigMaps/Secrets/RBAC — or any release that owns
Kubernetes objects but runs no pods of its own:

```yaml
workload:
  type: none

service:
  enabled: false

serviceAccount:
  create: true
  name: ci-writer

rbac:
  roles:
    writer:
      rules:
        - apiGroups: [""]
          resources: ["configmaps", "secrets"]
          verbs: ["get", "list", "watch", "update"]
  roleBindings:
    writer-binding:
      roleRef: writer
      subjects:
        - kind: ServiceAccount
          name: ci-writer

configMaps:
  namespace-ca-bundle:
    data:
      ca.crt: |
        -----BEGIN CERTIFICATE-----
        ...
        -----END CERTIFICATE-----
```

### Extra Services and Routes (fronting more than one hostname/port)

A microservice can declare additional `Service`/`Route` objects beyond the primary
`service`/`route` — useful for an admin port, a headless DNS service alongside a
ClusterIP one, or several OpenShift hostnames pointed at the same backend:

```yaml
service:
  enabled: true
  ports:
    http:
      port: 80
      targetPort: http

services:
  admin:
    enabled: true
    type: ClusterIP
    ports:
      admin-http:
        port: 8081

route:
  enabled: true
  host: myapp.apps.cluster.example.com

routes:
  admin-console:
    enabled: true
    host: admin.apps.cluster.example.com
    targetPort: admin-http
    serviceName: admin
```

---

## GitOps / ArgoCD Pattern

Use one chart installation per app, with layered `values.yaml` files:

```
apps/
  my-app/
    values.yaml          # base values (image, service, ingress)
    envs/
      dev/
        values.yaml      # dev overrides (1 replica, dev image tag)
      staging/
        values.yaml      # staging overrides
      prod/
        values.yaml      # prod overrides (3 replicas, resource limits)
```

ArgoCD Application referencing the chart:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-prod
spec:
  source:
    repoURL: https://github.com/my-org/charts
    path: universal-chart
    helm:
      valueFiles:
        - ../../apps/my-app/values.yaml
        - ../../apps/my-app/envs/prod/values.yaml
```

See `examples/3-apps-usage.yaml` for a full ArgoCD ApplicationSet example that auto-generates one Application per environment directory.

---

## Chart Validation

```bash
# Lint the chart for syntax issues
helm lint .

# Render with default values
helm template test .

# Render with a specific example
helm template test . -f examples/simple-webapp.yaml
helm template test . -f examples/full-example.yaml
helm template test . -f examples/app1-fullstack-webapp.yaml
helm template test . -f examples/app2-postgres-statefulset.yaml

# Run helm unit tests
helm unittest .
```

---

## Examples Directory

| File | Description |
|---|---|
| `simple-webapp.yaml` | Minimal deployment — image + service only |
| `full-example.yaml` | Full StatefulSet with every feature enabled |
| `app1-fullstack-webapp.yaml` | Full-stack web app: Deployment + Ingress + HPA + Secrets + ConfigMap |
| `app2-postgres-statefulset.yaml` | PostgreSQL StatefulSet with PVC templates, probes, and RBAC |
| `3-apps-usage.yaml` | ArgoCD ApplicationSet for frontend + backend + worker |
| `gitops/` | Ready-to-use GitOps repo layout with base + per-env values |

---

## Contributing

1. Make template changes in `templates/`
2. Add/update `tests/` for any new resource types
3. Update `values.yaml` with new keys (with comments)
4. Update `values.schema.json` if adding/removing top-level keys
5. Test with `helm unittest .` and `helm lint .`
6. For UI changes, update `ui/index.html` and add tests in the relevant `ui/*.test.js` file
7. Run `cd ui && npm test` to ensure all UI tests pass
