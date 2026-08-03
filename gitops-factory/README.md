# GitOps Factory — Raw Manifests → Universal Helm Chart → ArgoCD ApplicationSets

Converts raw per-namespace/per-microservice Kubernetes/OpenShift YAML dumps
into [Universal Chart](../Universal-chart) values files and ArgoCD
`ApplicationSet`s, and includes a mock-environment generator used to
stress-test the conversion at scale (5 namespaces x 50 microservices).

## Files

| File | Purpose |
|---|---|
| `convert_to_universal_chart.py` | The whole pipeline in one script: raw YAML in, Helm values + ApplicationSets out, then (unless `--skip-verify`) every generated release is rendered for real with `helm template` and checked so no two releases claim the same Kubernetes resource. |
| `generate_mock_environment.py` | Generates a large, deliberately messy mock raw-dump fixture. |

## Input contract

```
namespaces/
  <namespace>/
    shared.yaml              # optional — resources shared by multiple microservices
    <microservice-a>.yaml    # multi-document YAML, one file per microservice
    <microservice-b>.yaml
```

## Output layout

```
output/
  <namespace>/
    values/                            # comprehensive values — FLAT files, no per-microservice folder
      shared-values.yaml               # owns everything from shared.yaml
      <microservice>-values.yaml
    values-minimal/                    # image + literal env only — PARALLEL tree, same flat layout
      shared-values-minimal.yaml
      <microservice>-values-minimal.yaml
    releases/                          # tiny pointer files, NOT values — see below
      shared.yaml
      <microservice>.yaml
  cluster-shared/
    values/
      cluster-shared-values.yaml       # ClusterRole/ClusterRoleBinding/StorageClass/PV/SCC/ClusterSecretStore, deduped globally
  applicationsets/
    <namespace>-applicationset.yaml    # one ApplicationSet per namespace
    cluster-shared-application.yaml    # one Application, deployed once
  report/
    conversion_report.json
    conflicts_and_warnings.txt         # every auto-resolved naming conflict, explained
    render_conflicts.txt               # only written if the helm-template verification step finds a real conflict
```

Each namespace gets its own `values/` and `values-minimal/` — two **parallel**,
**flat** trees under that namespace (no subdirectory per microservice): every
`<microservice>-values.yaml` under `values/` has a matching
`<microservice>-values-minimal.yaml` under `values-minimal/`. `cluster-shared/`
is a sibling of the namespace directories, one level up, and only has a
`values/` tree (no minimal override for cluster-scoped resources).

The image tag and any literal-value (`value:`, not `valueFrom:`) env vars live
**exclusively** in `*-values-minimal.yaml` — the comprehensive `*-values.yaml`
omits them rather than duplicating them, so a day-2 image bump or config
tweak only ever touches the minimal file. `image.repository`, `pullPolicy`,
and any `valueFrom`-based env (ConfigMap/Secret/field refs — structural
wiring, not day-2 tuning) stay in the comprehensive file, since minimal has
nowhere else to apply them from.

`releases/<microservice>.yaml` is a tiny one-line pointer file (just
`release: <microservice>`) — **not** a values file. It exists purely so the
generated `ApplicationSet` can use a git **"files"** generator (matching
`releases/*.yaml`) instead of a "directories" generator, since there's no
longer a directory per microservice for it to enumerate. `{{release}}` in
the `ApplicationSet` template comes from that pointer file's own content and
is used to build the `values/{{release}}-values.yaml` /
`values-minimal/{{release}}-values-minimal.yaml` paths. `shared` gets a
pointer file too — it's not special-cased in the `ApplicationSet`, just
another release that happens to use `workload.type: none` so it owns
ConfigMaps/Secrets/RBAC/NetworkPolicies without running any pods.

## Why it's conflict-free

Several Universal Chart resource kinds render with the **raw values map-key**
as the Kubernetes resource name (no `<release>-` prefix): ConfigMap, Secret,
PVC, NetworkPolicy, Role, RoleBinding, and (cluster-scoped) ClusterRole,
ClusterRoleBinding, StorageClass, PersistentVolume, SecurityContextConstraints.
Those are exactly the ones that collide once every microservice becomes its
own Helm release. The converter resolves this deterministically:

1. **shared.yaml owns the canonical name.** Anything declared there becomes
   the namespace's `shared` release. If a microservice's own file also
   happens to contain that same object (a common artifact of raw cluster
   dumps that capture shared objects once per consuming workload), the
   duplicate is dropped and the microservice just references the shared
   name — no double ownership.
2. **Private name collisions are auto-renamed.** If two microservices
   independently declare a same-named ConfigMap/Secret/etc. that ISN'T from
   shared.yaml, the second one is renamed to `<microservice>-<name>`, and
   every reference to it inside that microservice's own values (`env`,
   `envFrom`, `volumes`, RBAC `roleRef`/`subjects`) is rewritten to match.
   Logged either way — silent when content is identical, still logged
   because two releases can never jointly own one object regardless.
3. **Cluster-scoped kinds are deduped globally**, across every namespace in
   the run, not renamed (a StorageClass/SCC name is referenced by exact
   string elsewhere, so renaming it would silently break those references).
   If two namespaces define the same cluster-scoped name with *different*
   content, the first wins and it's flagged in the report for a human to
   resolve — this is the one case that can't be auto-resolved safely.

See `conflicts_and_warnings.txt` after a run for the full, human-readable log
of every decision the converter made.

A microservice can also **consume** a ServiceAccount/Role/etc. it doesn't own
(e.g. a pod running as the namespace-shared ServiceAccount, or a RoleBinding
whose Role got renamed by the collision logic above). In that case its
values only get a *reference* — `serviceAccount.create: false` for a
consumed SA, remapped `roleRef`/`subjects`/`env`/`volumes` names for anything
renamed — never a duplicate ownership entry. This is order-independent
(resolved in a name-claiming pass before any resource is built) so it's
correct regardless of which order objects appear in the source multi-doc
file.

## Avoiding ArgoCD "OutOfSync every few seconds" from OpenShift admission

Two real drift sources are handled up front rather than patched after the
fact:

1. **Live Pod objects are never converted.** SCC/admission mutates the
   *Pod* (injecting `runAsUser`/`fsGroup`/`seLinuxOptions` from the
   namespace's allocated UID range), not the Deployment/StatefulSet/DaemonSet
   that owns it. The converter drops `Pod` and `ReplicaSet` objects entirely
   (`TRANSIENT_KINDS`) specifically so those admission-injected values are
   never captured into `podSecurityContext`/`securityContext` in the first
   place — the classic way teams accidentally bake a UID range from one
   namespace into a values file that then fights every other namespace's SCC.
2. **Every generated ApplicationSet still carries a defensive
   `ignoreDifferences`** (`common_ignore_differences()` in the converter) for
   the handful of fields OpenShift/Kubernetes mutate on the *live* object
   after admission regardless: `securityContext.{runAsUser,runAsGroup,
   fsGroup,seLinuxOptions}` on Deployment/StatefulSet/DaemonSet pod
   templates, container-level `runAsUser`/`capabilities`, and
   ServiceAccount's controller-populated `secrets`/`imagePullSecrets`.
   StatefulSet `volumeClaimTemplates` is included too — it's immutable after
   creation, so a diff there can never be applied and would otherwise loop
   forever. HPA-managed `replicas` needs no such entry: the chart's
   `deployment.yaml`/`statefulset.yaml` omit the `replicas` key from the
   rendered manifest entirely whenever `hpa.enabled: true`, so there's
   nothing for Argo to diff against in the first place.

## Chart changes made to support this (`../Universal-chart`)

- `workload.type: none` — new option (alongside `deployment`/`statefulset`/
  `daemonset`) for microservices with no compute workload at all (just
  ServiceAccounts/RBAC/ConfigMaps). Guarded in `_helpers.tpl` so `hpa`/`vpa`/
  `pdb` correctly refuse to enable with no pods to target.
- `routes: {}` / `services: {}` — new map-based, plural counterparts to the
  existing singular `route:`/`service:`, for microservices that legitimately
  need more than one OpenShift Route or Service object. The singular keys are
  untouched and remain the common-case path.
- `secretStores: {}` / `clusterSecretStores: {}` / `externalSecrets: {}` —
  [External Secrets Operator](https://external-secrets.io) support. The
  converter maps `SecretStore`/`ExternalSecret`/`ClusterSecretStore` objects
  from a raw dump into these directly (they're first-class `NS_RAW_NAME_KINDS`
  / `CLUSTER_SCOPED_KINDS` now, same dedup/collision handling as ConfigMap/
  Secret/StorageClass) — they no longer fall through to `extraDeploy`.

Everything else in the chart was already exactly what this conversion
needed (map-based values throughout, `extraDeploy` as a raw-YAML escape
hatch for anything unrecognized).

## Running the full end-to-end verification

```bash
cd gitops-factory
pip install pyyaml

# 1. Generate the mock raw-dump fixture: 5 namespaces x 50 microservices,
#    with deliberately planted naming conflicts and edge cases.
python generate_mock_environment.py --output namespaces --seed 42

# 2. Convert it AND verify it in one call. This does everything:
#      - builds Helm values + ApplicationSets from the raw manifests
#      - resolves/renames naming conflicts deterministically (logged)
#      - renders every generated release for real with `helm template` and
#        checks no two releases claim the same Kubernetes object
python convert_to_universal_chart.py --input namespaces --output output \
    --chart ../Universal-chart \
    --chart-repo-url  https://git.example.com/gitops/universal-chart.git \
    --values-repo-url https://git.example.com/gitops/microservices-values.git
```

`--chart` defaults to `../Universal-chart` (i.e. this repo's layout), so it
can usually be omitted. Pass `--skip-verify` to skip the `helm template`
render step (e.g. `helm` isn't installed, or you just want a fast dry run of
the conversion) — you still get the values/ApplicationSets/report either way.

Expected output:

```
Converted 250 microservices across 5 namespaces.
Auto-resolved conflicts / warnings: 51 (see output/report/conflicts_and_warnings.txt)
Values written under:          output/<namespace>/values/
Minimal values written under:  output/<namespace>/values-minimal/
ApplicationSets written under: output/applicationsets

Verifying against ../Universal-chart — rendering every release with `helm template`...
Rendered 256 releases.
Namespaced resource claims checked: 1518
Cluster-scoped resource claims checked: 3

No duplicate resource ownership detected across any of the 256 rendered releases. Conflict-free.
```

Check `output/report/conflicts_and_warnings.txt` — every entry there is a
conflict the converter resolved automatically (or, for the one deliberately
irreconcilable cluster-scoped fixture, flagged for manual review). If the
render-verification step ever finds a REAL conflict (it shouldn't, given the
static analysis above — this step exists to catch template bugs, not
converter bugs), it's written to `output/report/render_conflicts.txt` and the
script exits non-zero.

### Wiring it into a real ArgoCD

1. Push the `Universal-chart/` directory to the Git repo passed as
   `--chart-repo-url` (path defaults to `Universal-chart`, override with
   `--chart-path` if it lives elsewhere in that repo).
2. Push the per-namespace directories and `cluster-shared/` from `output/` to
   the Git repo passed as `--values-repo-url`, preserving the
   `<namespace>/values/`, `<namespace>/values-minimal/`, and
   `<namespace>/releases/` layout exactly as generated.
3. `kubectl apply -f output/applicationsets/` against your ArgoCD namespace.
   Each `<namespace>-applicationset.yaml` fans out into one Application per
   discovered `releases/*.yaml` pointer file (every microservice + that
   namespace's `shared`); `cluster-shared-application.yaml` is a single
   Application, applied once, for the cluster-scoped leftovers.
4. Re-run the converter whenever the raw dump changes and commit the diff —
   values files are regenerated deterministically from the source manifests,
   so treat them as generated artifacts, not something to hand-edit (the
   `-values-minimal.yaml` files are the one exception: they're explicitly the
   safe, human-editable day-2 override layer).

## Regenerating from scratch

Both scripts are idempotent given the same `--seed`/input. To start over:

```bash
rm -rf namespaces output
python generate_mock_environment.py --output namespaces --seed 42
python convert_to_universal_chart.py --input namespaces --output output
```

## Onboarding a real application/namespace

The mock fixture above exists to stress-test the converter at scale; onboarding a
real app follows the exact same input contract, just with real data:

1. **Dump the namespace's desired state.** For each namespace you're onboarding:
   ```bash
   oc get deployment,statefulset,daemonset,service,route,configmap,secret,pvc,\
   serviceaccount,role,rolebinding,networkpolicy,hpa,pdb,ingress,servicemonitor,\
   cronjob,job -n <namespace> -o yaml > namespaces/<namespace>/<microservice>.yaml
   ```
   Do this **per microservice** if the namespace hosts several distinct apps (one
   file per deployable unit), using label selectors (`-l app=<name>`) to split a
   namespace-wide dump into per-microservice files. Anything genuinely shared by
   every microservice in the namespace (a CA-bundle ConfigMap, a shared
   NetworkPolicy, a namespace-wide RoleBinding) goes in `namespaces/<namespace>/shared.yaml`
   instead — don't duplicate it into every microservice file, the converter
   already handles de-duplication FROM `shared.yaml` but can't guess which
   raw-dump copy was "the shared one" if you don't tell it via that filename.
   Cluster-scoped objects (`ClusterRole`, `ClusterRoleBinding`, `StorageClass`,
   `PersistentVolume`, `SecurityContextConstraints`) are fine left wherever they
   naturally show up in the dump — the converter finds and deduplicates them
   globally regardless of which file they're in.

2. **Sanity-check the raw dump before converting.** Raw `oc get -o yaml` output
   carries live cluster noise (`status`, `resourceVersion`, `Pod`/`ReplicaSet`
   instances, auto-generated `ServiceAccount` token Secrets, SCC-injected
   `runAsUser`/`fsGroup`). You don't need to strip any of this by hand — steps
   `sanitize_object()`/`filter_transient()` in the converter do it automatically
   — but it's worth a quick `grep -c "^kind:"` per file to make sure the dump
   actually captured everything you expect (an empty `service.yaml` selector
   because `oc get` was run with the wrong label selector is a common mistake,
   and it's much easier to catch before converting than after).

3. **Run the converter** exactly as in the mock walkthrough above, pointing
   `--input` at your real `namespaces/` tree:
   ```bash
   python convert_to_universal_chart.py --input namespaces --output output \
       --chart ../Universal-chart \
       --chart-repo-url  https://<your-git-host>/gitops/universal-chart.git \
       --values-repo-url https://<your-git-host>/gitops/microservices-values.git
   ```

4. **Read `output/report/conflicts_and_warnings.txt` before doing anything else.**
   For a real app, pay special attention to:
   - `renamed` entries — confirm the auto-rename (`<microservice>-<name>`) is
     actually what you want, not a sign that two microservices should have been
     sharing that ConfigMap/Secret/Role via `shared.yaml` instead.
   - `promoted to namespace-shared` entries — a microservice privately declared
     something that also got promoted to shared; verify that microservice's
     generated values now correctly *reference* the shared copy rather than
     still owning its own.
   - `[cluster-scoped]` conflicts with DIFFERING content — these are never
     auto-resolved and need a human decision about which definition is correct
     before you deploy either namespace.
   - `chart supports one managed ServiceAccount per release` — extra
     ServiceAccounts land in `extraDeploy`; double check nothing downstream
     (a RoleBinding subject, a pod's `serviceAccountName`) still expects the
     chart to manage it directly.

5. **Let the render-verification step do its job** (it runs automatically unless
   you passed `--skip-verify`) — if it exits non-zero, do not proceed to step 6
   until `output/report/render_conflicts.txt` is empty.

6. **Review the generated values by hand once, for the first onboarding of any
   given app.** In particular:
   - `<microservice>-values.yaml` is marked auto-generated / do-not-edit — treat
     it as such and re-run the converter instead of hand-patching it.
   - `<microservice>-values-minimal.yaml` is explicitly the safe, hand-editable
     override layer (image tag + literal env vars only) — this is where day-2
     changes belong (e.g. a config value a developer needs to tweak without
     re-running the whole conversion).
   - If the app needs something the converter has no first-class handling for
     (a CRD, an unusual resource kind), it'll have been passed through as raw
     YAML under `extraDeploy` with a warning — confirm that's actually fine
     rather than a sign the converter needs a new per-kind handler.

7. **Push and wire into ArgoCD** exactly as described below — same chart repo,
   same values repo layout, same `ApplicationSet` per namespace.

8. **Day 2**: whenever the source manifests change (a new microservice added to
   the namespace, a ConfigMap key changed upstream), re-run the converter and
   commit the diff. The values files are deterministic output — the git diff on
   `output/` is your review surface for "what actually changed", the same way
   you'd review a `terraform plan`.
