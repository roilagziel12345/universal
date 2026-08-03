# Universal Chart — Complete Cookbook

A practical reference for every feature with real-world examples.

---

## Table of Contents
1. [Workload Types](#1-workload-types)
2. [Image & Pull Secrets](#2-image--pull-secrets)
3. [Replicas, Revision History & Update Strategy](#3-replicas-revision-history--update-strategy)
4. [Environment Variables](#4-environment-variables)
5. [Ports](#5-ports)
6. [Resources & GPU](#6-resources--gpu)
7. [Probes — Liveness, Readiness, Startup](#7-probes)
8. [Volumes & Mounts — All Types](#8-volumes--mounts)
9. [Multi-PVC](#9-multi-pvc)
10. [Init Containers & Sidecars](#10-init-containers--sidecars)
11. [Scheduling — nodeSelector, Tolerations, Affinity, Topology Spread](#11-scheduling)
12. [Security Contexts](#12-security-contexts)
13. [Service](#13-service)
14. [Ingress (standard K8s)](#14-ingress)
15. [OpenShift Route](#15-openshift-route)
16. [ConfigMaps (multi)](#16-configmaps)
17. [Secrets (multi)](#17-secrets)
18. [PVC (standalone, multi)](#18-pvc)
19. [PersistentVolume](#19-persistentvolume)
20. [StorageClass](#20-storageclass)
21. [StatefulSet + volumeClaimTemplates](#21-statefulset--volumeclaimtemplates)
22. [CronJobs (multi)](#22-cronjobs)
23. [Jobs & ArgoCD Hooks](#23-jobs--argocd-hooks)
24. [HPA — Horizontal Pod Autoscaler](#24-hpa)
25. [VPA — Vertical Pod Autoscaler](#25-vpa)
26. [PodDisruptionBudget](#26-poddisruptionbudget)
27. [NetworkPolicy (multi)](#27-networkpolicy)
28. [RBAC](#28-rbac)
29. [ServiceMonitor (Prometheus)](#29-servicemonitor)
30. [extraDeploy — Raw YAML](#30-extradeploy)
31. [Container Restart Rules (K8s 1.35+)](#31-container-restart-rules)
32. [Checksums — Opt-in Pod Restart on Config Change](#32-checksums)
33. [StatefulSet Pod Anti-Affinity](#33-statefulset-pod-anti-affinity)
34. [OpenShift SecurityContextConstraints (SCC)](#34-openshift-scc)
35. [Config/RBAC-only Releases (workload.type: none)](#35-config-rbac-only-releases)
36. [Multiple Services (map-based)](#36-multiple-services)
37. [Multiple OpenShift Routes (map-based)](#37-multiple-openshift-routes)

---

## 1. Workload Types

Pick **one** — controls which K8s object is rendered.

```yaml
workload:
  type: deployment    # standard web app, API, etc.

workload:
  type: statefulset   # database, queue, anything needing stable network identity or ordered pods

workload:
  type: daemonset     # runs on EVERY node — log agents, monitoring, node-level tools

workload:
  type: none          # no Deployment/StatefulSet/DaemonSet at all — config/RBAC-only release
```

> **Rule of thumb**: Use `statefulset` if pods need stable hostnames (`pod-0`, `pod-1`) or per-pod persistent storage. Use `daemonset` for infra components. Use `none` when the release owns no pods at all (see [§35](#35-config-rbac-only-releases)). Everything else: `deployment`.

---

## 2. Image & Pull Secrets

```yaml
image:
  repository: my-registry.example.com/myteam/backend
  tag: "2.3.1"
  pullPolicy: IfNotPresent    # Always | IfNotPresent | Never

# Private registry needs a pull secret
imagePullSecrets:
  - name: my-registry-pull-secret
```

> Leave `tag` empty → uses `Chart.appVersion` automatically.

---

## 3. Replicas, Revision History & Update Strategy

### replicaCount & revisionHistoryLimit

```yaml
replicaCount: 3
revisionHistoryLimit: 5    # keep last 5 ReplicaSets for rollback (default: 3)
```

### Update Strategy — Deployment (zero-downtime)

```yaml
# Default: always have 1 extra pod during rollout, never take any down
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1          # how many EXTRA pods can exist during rollout
    maxUnavailable: 0    # how many pods can be unavailable (0 = always at full capacity)

# Recreate: kill ALL old pods first, then start new ones (brief downtime, simpler)
strategy:
  type: Recreate
```

### Update Strategy — StatefulSet

```yaml
workload:
  type: statefulset

# Rolling update but start from the last pod (pod-N first, pod-0 last)
strategy:
  type: RollingUpdate
  rollingUpdate:
    partition: 0    # only update pods with ordinal >= partition
                    # set partition: 2 to only update pod-2+ (canary rollout)

# Manual: pods are NOT auto-updated; you delete manually to trigger update
strategy:
  type: OnDelete
```

> **StatefulSet canary trick**: Set `partition: 2` to only update `pod-2` while `pod-0`/`pod-1` stay on old version. Test it, then set `partition: 0` to complete the rollout.

### Update Strategy — DaemonSet

```yaml
workload:
  type: daemonset

strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1    # update 1 node at a time
    maxSurge: 0

# Or: only update when you manually delete the pod on each node
strategy:
  type: OnDelete
```

### StatefulSet Pod Management

```yaml
podManagementPolicy: OrderedReady   # default: pod-0 ready → pod-1 starts → pod-2 starts
podManagementPolicy: Parallel       # all pods start/stop simultaneously (faster, less safe)
```

---

## 4. Environment Variables

All styles supported, as many as you want:

```yaml
env:
  # Plain value
  - name: NODE_ENV
    value: production

  # From another env var / downward API (pod info)
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name

  - name: POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP

  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName

  # From resource limits
  - name: MEMORY_LIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.memory

  # From a ConfigMap key
  - name: DB_HOST
    valueFrom:
      configMapKeyRef:
        name: backend-config
        key: db-host

  # From a Secret key
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: backend-secret
        key: password

# Inject an entire ConfigMap or Secret as env vars (all keys → env vars)
envFrom:
  - configMapRef:
      name: backend-config
  - secretRef:
      name: backend-secret
```

---

## 5. Ports

Expose multiple ports from the same container:

```yaml
ports:
  - name: http
    containerPort: 8080
    protocol: TCP
  - name: grpc
    containerPort: 9090
    protocol: TCP
  - name: metrics
    containerPort: 9091
    protocol: TCP
  - name: debug
    containerPort: 5005
    protocol: TCP
```

---

## 6. Resources & GPU

```yaml
resources:
  requests:
    cpu: 200m       # 0.2 CPU cores minimum guaranteed
    memory: 256Mi   # 256MB RAM minimum guaranteed
  limits:
    cpu: 1000m      # 1 full CPU core max
    memory: 1Gi     # 1GB RAM max — OOMKilled if exceeded

# GPU (needs device plugin installed on cluster)
resources:
  requests:
    nvidia.com/gpu: 1
  limits:
    nvidia.com/gpu: 1
```

---

## 7. Probes

All probe types for all three probe fields:

```yaml
# HTTP probe — best for web apps
livenessProbe:
  httpGet:
    path: /healthz
    port: http          # references the named port above
    httpHeaders:
      - name: Authorization
        value: Bearer my-token
  initialDelaySeconds: 10   # wait 10s before first check
  periodSeconds: 15         # check every 15s
  timeoutSeconds: 5         # fail if no response in 5s
  failureThreshold: 3       # restart after 3 consecutive failures
  successThreshold: 1       # 1 success = healthy

# TCP probe — for non-HTTP services (postgres, redis, etc.)
readinessProbe:
  tcpSocket:
    port: 5432
  initialDelaySeconds: 5
  periodSeconds: 10

# Exec probe — run a command inside the container
readinessProbe:
  exec:
    command: ["/bin/sh", "-c", "pg_isready -U postgres"]
  periodSeconds: 10

# gRPC probe — for gRPC services
livenessProbe:
  grpc:
    port: 9090
    service: liveness

# Startup probe — protects slow-starting apps (disables liveness until started)
startupProbe:
  httpGet:
    path: /healthz
    port: http
  failureThreshold: 30   # allow up to 30 * 10 = 300 seconds to start
  periodSeconds: 10
```

---

## 8. Volumes & Mounts

First define the volume, then mount it. You can have as many as you want.

### ConfigMap as files

```yaml
configMaps:
  - name: nginx-config
    data:
      nginx.conf: |
        server {
          listen 80;
          location / { proxy_pass http://backend; }
        }

volumes:
  - name: nginx-conf
    configMap:
      name: nginx-config
      defaultMode: 0644

volumeMounts:
  - name: nginx-conf
    mountPath: /etc/nginx/conf.d
    readOnly: true
```

### Secret as files (TLS certs, ssh keys)

```yaml
volumes:
  - name: tls-certs
    secret:
      secretName: my-tls-secret
      defaultMode: 0400   # read-only for owner only
      items:
        - key: tls.crt
          path: server.crt
        - key: tls.key
          path: server.key

volumeMounts:
  - name: tls-certs
    mountPath: /etc/ssl/certs
    readOnly: true
```

### EmptyDir — shared scratch space between containers

```yaml
volumes:
  - name: tmp-space
    emptyDir: {}

  - name: shared-mem        # RAM-backed shared memory
    emptyDir:
      medium: Memory
      sizeLimit: 512Mi

volumeMounts:
  - name: tmp-space
    mountPath: /tmp
  - name: shared-mem
    mountPath: /dev/shm
```

### Projected — combine SA token + ConfigMap + Secret in one volume

```yaml
volumes:
  - name: combined
    projected:
      sources:
        - serviceAccountToken:
            path: token
            expirationSeconds: 3600
        - configMap:
            name: my-config
        - secret:
            name: my-secret
        - downwardAPI:
            items:
              - path: pod-labels
                fieldRef:
                  fieldPath: metadata.labels

volumeMounts:
  - name: combined
    mountPath: /var/run/secrets/combined
```

### CSI — Secrets Store (Vault, AWS Secrets Manager, Azure KV)

```yaml
volumes:
  - name: vault-secrets
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: vault-myapp

volumeMounts:
  - name: vault-secrets
    mountPath: /mnt/secrets
    readOnly: true
```

### NFS

```yaml
volumes:
  - name: shared-data
    nfs:
      server: nfs.internal.example.com
      path: /exports/myapp
      readOnly: false

volumeMounts:
  - name: shared-data
    mountPath: /data/shared
```

### SubPath — mount only one file (not the whole volume)

```yaml
volumeMounts:
  - name: config-vol
    mountPath: /etc/app/config.yaml
    subPath: config.yaml        # mount only this key from the configmap
```

---

## 9. Multi-PVC

Two approaches depending on whether you use Deployment or StatefulSet:

### Deployment with multiple standalone PVCs

```yaml
# Creates the PVCs as separate K8s resources
pvc:
  - name: app-data
    accessModes: [ReadWriteOnce]
    size: 50Gi
    storageClassName: fast-ssd
  - name: app-logs
    accessModes: [ReadWriteOnce]
    size: 10Gi
  - name: app-cache
    accessModes: [ReadWriteOnce]
    size: 5Gi

# Reference them in the pod
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: app-data
  - name: logs
    persistentVolumeClaim:
      claimName: app-logs
  - name: cache
    persistentVolumeClaim:
      claimName: app-cache

# Mount each at a different path
volumeMounts:
  - name: data
    mountPath: /var/data
  - name: logs
    mountPath: /var/log/app
  - name: cache
    mountPath: /var/cache/app
```

### StatefulSet with volumeClaimTemplates (one PVC set PER REPLICA)

```yaml
workload:
  type: statefulset
replicaCount: 3

# This creates: data-myapp-0, data-myapp-1, data-myapp-2
#               wal-myapp-0,  wal-myapp-1,  wal-myapp-2
volumeClaimTemplates:
  - name: data
    accessModes: [ReadWriteOnce]
    size: 100Gi
    storageClassName: fast-ssd
  - name: wal
    accessModes: [ReadWriteOnce]
    size: 20Gi
    storageClassName: fast-ssd

volumeMounts:
  - name: data
    mountPath: /var/lib/postgresql/data
  - name: wal
    mountPath: /var/lib/postgresql/wal
```

---

## 10. Init Containers & Sidecars

### Init containers (run first, must complete before main container starts)

```yaml
initContainers:
  # Wait for DB to be ready
  - name: wait-for-db
    image: busybox:1.36
    command: ["sh", "-c", "until nc -z postgres 5432; do echo waiting; sleep 2; done"]

  # Run DB migrations
  - name: migrate
    image: my-registry/backend:2.0
    command: ["python", "manage.py", "migrate"]
    env:
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: backend-secret
            key: DATABASE_URL

  # Download config from S3
  - name: fetch-config
    image: amazon/aws-cli:latest
    command: ["aws", "s3", "cp", "s3://my-bucket/config.yaml", "/config/config.yaml"]
    volumeMounts:
      - name: config-vol
        mountPath: /config
```

### Sidecar containers (run alongside main container, whole pod lifetime)

```yaml
sidecars:
  # Log shipping (reads app logs, ships to Elasticsearch)
  - name: log-shipper
    image: elastic/filebeat:8.0
    volumeMounts:
      - name: app-logs
        mountPath: /var/log/app
        readOnly: true
    resources:
      requests:
        cpu: 50m
        memory: 64Mi

  # Vault agent (refreshes secrets without app restart)
  - name: vault-agent
    image: hashicorp/vault:1.15
    args: ["agent", "-config=/vault/config.hcl"]
    volumeMounts:
      - name: vault-config
        mountPath: /vault

  # Envoy proxy sidecar (service mesh / mTLS)
  - name: envoy
    image: envoyproxy/envoy:v1.28
    ports:
      - containerPort: 15090
        name: envoy-metrics
```

---

## 11. Scheduling

### nodeSelector — target specific nodes

```yaml
nodeSelector:
  kubernetes.io/os: linux
  node-role: app          # custom label on your nodes
  disk: ssd
```

### Tolerations — schedule onto tainted nodes

```yaml
# Taint on node: kubectl taint nodes gpu-node nvidia.com/gpu=true:NoSchedule
tolerations:
  - key: nvidia.com/gpu
    operator: Equal
    value: "true"
    effect: NoSchedule

# Tolerate node not-ready for up to 5 minutes before eviction
  - key: node.kubernetes.io/not-ready
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 300
```

### Affinity — prefer or require certain nodes/pods

```yaml
affinity:
  # REQUIRE nodes in zone us-east-1a or us-east-1b
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: topology.kubernetes.io/zone
              operator: In
              values: [us-east-1a, us-east-1b]

  # PREFER to spread away from other instances of this app
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: myapp
          topologyKey: kubernetes.io/hostname   # one per node
```

### Topology Spread — evenly distribute pods

```yaml
# Spread pods evenly across nodes (max 1 skew)
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: myapp

# Also spread evenly across AZs
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: myapp
```

---

## 12. Security Contexts

### Pod level (affects all containers)

```yaml
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 3000
  fsGroup: 2000                    # volume files owned by this group
  fsGroupChangePolicy: OnRootMismatch   # faster: only chown if needed
  seccompProfile:
    type: RuntimeDefault           # recommended baseline
  supplementalGroups: [1000, 2000]
```

### Container level

```yaml
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true     # nothing can write to the container FS
  capabilities:
    drop: [ALL]                    # drop everything
    add: [NET_BIND_SERVICE]        # only add what you need (port < 1024)
  runAsUser: 1000
```

### OpenShift — restricted-v2 SCC compatible

```yaml
podSecurityContext:
  seccompProfile:
    type: RuntimeDefault
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
```

---

## 13. Service

```yaml
# ClusterIP — internal only (default)
service:
  enabled: true
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: http
    - name: grpc
      port: 9090
      targetPort: grpc
    - name: metrics
      port: 9091
      targetPort: metrics

# NodePort — accessible from outside on a high port
service:
  type: NodePort
  ports:
    - name: http
      port: 80
      targetPort: http
      nodePort: 30080    # fixed port on every node

# LoadBalancer — cloud provider creates an LB
service:
  type: LoadBalancer
  loadBalancerSourceRanges:
    - 10.0.0.0/8       # restrict to internal network only
  ports:
    - name: https
      port: 443
      targetPort: https

# ExternalName — CNAME alias to an external DNS name (no selector rendered)
service:
  type: ExternalName
  externalName: my.database.example.com

# Headless — for StatefulSet DNS (pod-0.myapp, pod-1.myapp, ...)
service:
  type: ClusterIP
  clusterIP: None
  publishNotReadyAddresses: true    # include not-ready pods in DNS (required for DB clusters)

# Session affinity — sticky sessions routed to the same pod
service:
  type: ClusterIP
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800   # 3 hours
```

> **ExternalName note**: The `selector` field is automatically **omitted** for `ExternalName` services — Kubernetes rejects it otherwise.

---

## 14. Ingress

```yaml
ingress:
  enabled: true
  className: nginx

  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"

  # Multiple hosts and paths
  hosts:
    - host: api.example.com
      paths:
        - path: /v1
          pathType: Prefix
          portName: http
        - path: /v2
          pathType: Prefix
          portName: http

    - host: admin.example.com
      paths:
        - path: /
          pathType: Prefix
          portName: http

  tls:
    - secretName: api-tls
      hosts: [api.example.com]
    - secretName: admin-tls
      hosts: [admin.example.com]
```

---

## 15. OpenShift Route

```yaml
# Edge — TLS terminates at the router, HTTP to your pod
route:
  enabled: true
  host: myapp.apps.cluster.example.com   # omit (leave "") for OpenShift auto-assign
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect   # force HTTPS

# Passthrough — TLS goes all the way to your pod (you handle TLS)
route:
  enabled: true
  tls:
    termination: passthrough
    # no certificate here — pod handles it entirely

# Reencrypt — TLS from client to router, then NEW TLS from router to pod
route:
  enabled: true
  tls:
    termination: reencrypt
    destinationCACertificate: |
      -----BEGIN CERTIFICATE-----
      ...your pod's CA cert...
      -----END CERTIFICATE-----

# Custom certificate on the route (edge or reencrypt)
route:
  enabled: true
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
    certificate: |
      -----BEGIN CERTIFICATE-----
      ...PEM cert...
      -----END CERTIFICATE-----
    key: |
      -----BEGIN RSA PRIVATE KEY-----
      ...PEM key...
      -----END RSA PRIVATE KEY-----
    caCertificate: |
      -----BEGIN CERTIFICATE-----
      ...intermediate CA...
      -----END CERTIFICATE-----
```

> **Auto-assign hostname**: Leave `host: ""` (empty string) and OpenShift will generate a hostname automatically. The `host` field is **omitted** from the manifest in that case — setting it to `""` explicitly would be invalid.

---

## 16. ConfigMaps

Multiple ConfigMaps, each with their own data:

```yaml
configMaps:
  # App config as key-value
  - name: app-config
    annotations:
      description: "Main app configuration"
    labels:
      config-type: app
    data:
      LOG_LEVEL: info
      MAX_CONNECTIONS: "100"
      FEATURE_FLAG_X: "true"

  # Nginx config as a file
  - name: nginx-config
    data:
      nginx.conf: |
        worker_processes auto;
        events { worker_connections 1024; }
        http {
          server {
            listen 80;
            location /health { return 200; }
            location / { proxy_pass http://localhost:8080; }
          }
        }

  # Binary data (pre-base64-encoded — for certs, keystores, etc.)
  - name: tls-bundle
    binaryData:
      ca-bundle.crt: <base64-encoded-binary>

  # Mixed: both text data and binary data in the same ConfigMap
  - name: app-scripts
    data:
      start.sh: |
        #!/bin/bash
        echo "Starting..."
        exec /app/server
      healthcheck.sh: |
        #!/bin/bash
        curl -f http://localhost:8080/health
    binaryData:
      logo.png: <base64-encoded-binary>
```

> A ConfigMap can have `data`, `binaryData`, or both — all are optional. The template handles nil gracefully.

---

## 17. Secrets

```yaml
secrets:
  # DB credentials (plain text — K8s base64-encodes automatically)
  - name: db-secret
    stringData:
      DATABASE_URL: postgres://user:pass@postgres:5432/mydb
      DB_PASSWORD: "super-secret-password"

  # Pre-encoded (base64) values
  - name: api-keys
    data:
      STRIPE_KEY: c3RyaXBlLXNlY3JldA==   # base64

  # TLS certificate
  - name: tls-secret
    type: kubernetes.io/tls
    data:
      tls.crt: <base64-encoded-cert>
      tls.key: <base64-encoded-key>

  # Docker registry auth
  - name: registry-secret
    type: kubernetes.io/dockerconfigjson
    data:
      .dockerconfigjson: <base64-encoded-docker-config>
```

> **Auto-restart on secret change**: Already built in — when you update a secret in values.yaml, the pod rolls automatically.

---

## 18. PVC

```yaml
pvc:
  - name: app-data
    accessModes: [ReadWriteOnce]    # one pod can write
    size: 100Gi
    storageClassName: fast-ssd
    volumeMode: Filesystem          # Filesystem (default) | Block

  - name: shared-data
    accessModes: [ReadWriteMany]    # multiple pods can write (NFS/Ceph)
    size: 500Gi
    storageClassName: cephfs

  # Bind to a specific PV by name
  - name: static-bound
    accessModes: [ReadWriteOnce]
    size: 50Gi
    volumeName: my-manually-created-pv   # binds only to this exact PV

  # Bind to a specific PV by label selector
  - name: label-selected
    accessModes: [ReadWriteOnce]
    size: 50Gi
    selector:
      matchLabels:
        storage-tier: gold

  # Clone from a snapshot
  - name: restored-data
    accessModes: [ReadWriteOnce]
    size: 100Gi
    dataSource:
      name: my-daily-snapshot
      kind: VolumeSnapshot
      apiGroup: snapshot.storage.k8s.io
```

> `volumeMode: Block` skips filesystem formatting — the app gets a raw block device. Requires the PVC and the pod's `volumeDevices` (not `volumeMounts`).

---

## 19. PersistentVolume

Use when you want to **manually provision** storage (static provisioning):

```yaml
persistentVolumes:
  # Local SSD on a specific node
  - name: local-ssd-node1
    capacity: 200Gi
    accessModes: [ReadWriteOnce]
    reclaimPolicy: Retain
    storageClassName: local-storage
    local:
      path: /mnt/ssd
    nodeAffinity:
      required:
        nodeSelectorTerms:
          - matchExpressions:
              - key: kubernetes.io/hostname
                operator: In
                values: [worker-node-1]

  # NFS share
  - name: nfs-exports
    capacity: 1Ti
    accessModes: [ReadWriteMany]
    reclaimPolicy: Retain
    nfs:
      server: nfs.internal.example.com
      path: /exports/myapp
```

---

## 20. StorageClass

```yaml
storageClasses:
  # Fast SSD via AWS EBS CSI
  - name: fast-ssd
    provisioner: ebs.csi.aws.com
    reclaimPolicy: Delete
    volumeBindingMode: WaitForFirstConsumer
    allowVolumeExpansion: true
    parameters:
      type: gp3
      iops: "16000"
      throughput: "1000"
      encrypted: "true"

  # OpenShift OCS/ODF CephFS
  - name: ocs-cephfs
    provisioner: openshift-storage.cephfs.csi.ceph.com
    reclaimPolicy: Delete
    volumeBindingMode: Immediate
    allowVolumeExpansion: true
    parameters:
      clusterID: openshift-storage
      fsName: ocs-storagecluster-cephfilesystem
```

---

## 21. StatefulSet + volumeClaimTemplates

Best for databases. Each pod replica gets its OWN PVC automatically:

```yaml
workload:
  type: statefulset
replicaCount: 3

# Headless service needed for DNS
service:
  clusterIP: None

ports:
  - name: postgres
    containerPort: 5432

# Creates: data-myapp-0, data-myapp-1, data-myapp-2  (one per pod)
volumeClaimTemplates:
  - name: data
    accessModes: [ReadWriteOnce]
    size: 100Gi
    storageClassName: fast-ssd
  - name: wal
    accessModes: [ReadWriteOnce]
    size: 20Gi

volumeMounts:
  - name: data
    mountPath: /var/lib/postgresql/data
  - name: wal
    mountPath: /var/lib/postgresql/pg_wal
```

---

## 22. CronJobs

```yaml
cronjobs:
  # Daily DB backup at 2am
  - name: db-backup
    schedule: "0 2 * * *"             # min hour day month weekday
    concurrencyPolicy: Forbid         # Allow | Forbid | Replace
    successfulJobsHistoryLimit: 3
    failedJobsHistoryLimit: 1
    suspend: false                    # set true to pause without deleting
    startingDeadlineSeconds: 300      # fail if not started within 5 min of scheduled time
    jobTemplate:
      restartPolicy: OnFailure
      backoffLimit: 3
      activeDeadlineSeconds: 3600     # kill the job after 1 hour
      ttlSecondsAfterFinished: 86400  # auto-delete finished job after 24h
      command: ["/bin/sh", "-c", "pg_dump $DATABASE_URL | gzip > /backup/$(date +%Y%m%d).sql.gz"]
      env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: DATABASE_URL
      resources:
        requests:
          cpu: 100m
          memory: 256Mi

  # Every 5 minutes — clean expired sessions
  - name: session-cleanup
    schedule: "*/5 * * * *"
    concurrencyPolicy: Replace        # replace the running job with the new one
    suspend: false
    jobTemplate:
      restartPolicy: Never
      ttlSecondsAfterFinished: 600    # auto-delete after 10 minutes
      command: ["python", "manage.py", "clearsessions"]
```

> `suspend: true` pauses the schedule without deleting the CronJob — useful for maintenance windows. `startingDeadlineSeconds` protects against missed-schedule pile-ups on cluster restart.

---

## 23. Jobs & ArgoCD Hooks

Jobs run once. Perfect for DB migrations before deploy:

```yaml
jobs:
  # Pre-deploy DB migration (ArgoCD PreSync hook)
  - name: db-migrate
    annotations:
      argocd.argoproj.io/hook: PreSync
      argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
    restartPolicy: OnFailure
    backoffLimit: 3
    ttlSecondsAfterFinished: 3600   # auto-delete after 1 hour
    command: ["python", "manage.py", "migrate", "--noinput"]
    envFrom:
      - secretRef:
          name: db-secret

  # Post-deploy smoke test (ArgoCD PostSync hook)
  - name: smoke-test
    annotations:
      argocd.argoproj.io/hook: PostSync
      argocd.argoproj.io/hook-delete-policy: HookSucceeded
    restartPolicy: Never
    command: ["/bin/sh", "-c", "curl -f http://myapp/healthz && echo OK"]
```

---

## 24. HPA

Auto-scale based on CPU, memory, or custom metrics:

```yaml
hpa:
  enabled: true
  minReplicas: 2
  maxReplicas: 20

  metrics:
    # Scale up when CPU > 70%
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70

    # Scale up when memory > 512MB average
    - type: Resource
      resource:
        name: memory
        target:
          type: AverageValue
          averageValue: 512Mi

    # Custom metric (e.g. queue depth from Prometheus adapter)
    - type: Pods
      pods:
        metric:
          name: queue_messages_pending
        target:
          type: AverageValue
          averageValue: 100

  # Control scale-up/down speed
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30    # wait 30s of sustained high load before scaling up
      policies:
        - type: Pods
          value: 4                      # add at most 4 pods per period
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # wait 5 minutes before scaling down
      policies:
        - type: Percent
          value: 25                     # remove at most 25% of pods per period
          periodSeconds: 60
```

---

## 25. VPA

Let K8s learn and auto-tune your CPU/memory:

```yaml
vpa:
  enabled: true
  updateMode: Auto    # Off = just recommendations | Initial = set at pod start | Auto = live evict+resize

  resourcePolicy:
    containerPolicies:
      - containerName: "*"     # applies to all containers
        minAllowed:
          cpu: 50m
          memory: 64Mi
        maxAllowed:
          cpu: 4
          memory: 4Gi
        controlledResources: [cpu, memory]
```

> ⚠️ Don't use HPA (cpu) + VPA (cpu) together — they conflict. HPA for scaling pods horizontally, VPA for tuning a single pod's resources.

---

## 26. PodDisruptionBudget

Protects your app during node drains/upgrades:

```yaml
pdb:
  enabled: true
  minAvailable: 2      # always keep at least 2 pods running

# OR as a percentage
pdb:
  enabled: true
  minAvailable: "50%"  # keep at least half running

# OR define max disruption
pdb:
  enabled: true
  maxUnavailable: 1    # allow at most 1 pod to be down at a time
```

---

## 27. NetworkPolicy

Restrict traffic at the pod level:

```yaml
networkPolicies:
  # Only allow traffic FROM frontend pods TO backend
  - name: backend-allow-from-frontend
    podSelector:
      matchLabels:
        app.kubernetes.io/name: backend
    policyTypes: [Ingress]
    ingress:
      - from:
          - podSelector:
              matchLabels:
                app.kubernetes.io/name: frontend
        ports:
          - protocol: TCP
            port: 8080

  # Deny ALL egress except DNS + postgres
  - name: backend-egress
    podSelector: {}
    policyTypes: [Egress]
    egress:
      - ports:
          - port: 53
            protocol: UDP   # DNS
      - to:
          - podSelector:
              matchLabels:
                app.kubernetes.io/name: postgres
        ports:
          - port: 5432
```

---

## 28. RBAC

```yaml
serviceAccount:
  create: true
  name: myapp-sa
  annotations:
    # OpenShift: use specific UID range
    openshift.io/sa.scc.uid-range: "1000/10000"
    # AWS: IRSA (IAM Roles for Service Accounts)
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/myapp-role
    # GCP Workload Identity
    iam.gke.io/gcp-service-account: myapp@project.iam.gserviceaccount.com

rbac:
  roles:
    - name: myapp-role
      # namespace is set automatically to .Release.Namespace — no need to specify it
      rules:
        - apiGroups: [""]
          resources: ["configmaps", "secrets"]
          verbs: ["get", "list", "watch"]
        - apiGroups: [""]
          resources: ["pods"]
          verbs: ["get", "list"]

  roleBindings:
    - name: myapp-rolebinding
      roleRef: myapp-role   # name of the Role above
      # namespace is set automatically to .Release.Namespace
      subjects:
        - kind: ServiceAccount
          name: myapp-sa
          namespace: myapp-dev

  # Cluster-wide read (e.g. for an operator) — no namespace field (cluster-scoped)
  clusterRoles:
    - name: myapp-cluster-reader
      rules:
        - apiGroups: [""]
          resources: ["nodes", "namespaces"]
          verbs: ["get", "list", "watch"]

  clusterRoleBindings:
    - name: myapp-cluster-rb
      roleRef: myapp-cluster-reader   # name of the ClusterRole above
      subjects:
        - kind: ServiceAccount
          name: myapp-sa
          namespace: myapp-dev
```

> **Namespace behaviour**: `Role` and `RoleBinding` are automatically created in `{{ .Release.Namespace }}`. `ClusterRole` and `ClusterRoleBinding` are cluster-scoped and have no namespace.

---

## 29. ServiceMonitor

Tells Prometheus to scrape your app:

```yaml
ports:
  - name: http
    containerPort: 8080
  - name: metrics
    containerPort: 9091

serviceMonitor:
  enabled: true
  namespace: monitoring      # namespace where the ServiceMonitor is created (default: Release.Namespace)
  port: metrics              # must match a service port name
  path: /metrics
  interval: 30s
  scrapeTimeout: 10s
  scheme: http               # http (default) | https
  labels:
    release: prometheus      # must match your Prometheus operator selector

  # mTLS scraping (when scheme: https)
  tlsConfig:
    insecureSkipVerify: true  # or provide ca/cert/key
    # ca:
    #   secret:
    #     name: prometheus-tls
    #     key: ca.crt

  # Re-label metrics (add/rename labels)
  relabelings:
    - sourceLabels: [__meta_kubernetes_pod_name]
      targetLabel: pod
    - sourceLabels: [__meta_kubernetes_pod_label_version]
      targetLabel: version

  # Filter/transform metrics after scrape
  metricRelabelings:
    - sourceLabels: [__name__]
      regex: go_.*              # drop all Go runtime metrics
      action: drop
```

---

## 30. extraDeploy

Inject any K8s/OpenShift resource not covered by the chart. Supports full Helm templating:

```yaml
extraDeploy:
  # A custom ConfigMap with the release name
  - |
    apiVersion: v1
    kind: ConfigMap
    metadata:
      name: {{ .Release.Name }}-feature-flags
      namespace: {{ .Release.Namespace }}
    data:
      FEATURE_NEW_UI: "true"
      FEATURE_BETA: "false"

  # PrometheusRule for alerting
  - |
    apiVersion: monitoring.coreos.com/v1
    kind: PrometheusRule
    metadata:
      name: {{ .Release.Name }}-alerts
      labels:
        prometheus: kube-prometheus
    spec:
      groups:
        - name: {{ .Release.Name }}.rules
          rules:
            - alert: HighErrorRate
              expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
              for: 5m
              annotations:
                summary: "High error rate on {{ .Release.Name }}"

  # OpenShift ImageStream
  - |
    apiVersion: image.openshift.io/v1
    kind: ImageStream
    metadata:
      name: {{ .Release.Name }}
    spec:
      lookupPolicy:
        local: false

  # Kyverno policy / OPA constraint / any CRD
  - |
    apiVersion: kyverno.io/v1
    kind: Policy
    metadata:
      name: {{ .Release.Name }}-require-labels
    spec:
      rules:
        - name: require-labels
          match:
            resources:
              kinds: [Pod]
          validate:
            message: "label app.kubernetes.io/name is required"
            pattern:
              metadata:
                labels:
                  app.kubernetes.io/name: "?*"
```

---

## 31. Container Restart Rules

> **Requires**: Kubernetes 1.35+ with feature gate `RestartAllContainersOnContainerExits` enabled (alpha).

In-place pod restart — all containers restart without deleting/recreating the pod. Preserves pod UID, IP, network namespace, sandbox, and all volumes (emptyDir + PVC).

### Java app with C++ sidecar — restart all on segfault (exit code 139)

A C++ sidecar crashes with SIGSEGV (exit code 139). An in-place restart re-runs the init container to re-fetch the OpenTelemetry Java agent, then restarts both the Java app and the sidecar — without losing the pod's IP or rescheduling:

```yaml
restartPolicy: Never

initContainers:
  - name: otel-agent
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:2.14.0
    command: ["cp", "/javaagent.jar", "/otel/javaagent.jar"]
    volumeMounts:
      - name: otel
        mountPath: /otel

image:
  repository: my-registry/java-app
  tag: "3.1"

env:
  - name: JAVA_TOOL_OPTIONS
    value: "-javaagent:/otel/javaagent.jar"

sidecars:
  - name: native-processor
    image: my-registry/cpp-processor:1.0
    containerRestartRules:
      - exitCode: 139
        action: RestartAllContainers

volumeMounts:
  - name: otel
    mountPath: /otel
    readOnly: true

volumes:
  - name: otel
    emptyDir: {}
```

### What happens on restart

1. All running containers are terminated
2. Init containers re-run **in order** (fresh initialization)
3. Sidecar and regular containers restart
4. Ephemeral containers are terminated
5. Pod UID, IP, network namespace, and all volumes are preserved

### Main container restart rule

The top-level `containerRestartRules` key applies to the **main container**:

```yaml
containerRestartRules:
  - exitCode: 137
    action: RestartAllContainers
```

> **Note**: For sidecars and init containers, include `containerRestartRules` directly in the container spec (passed through as-is).

### Common exit codes reference

| Exit Code | Signal | Meaning |
|---|---|---|
| 1 | — | General error (application-defined) |
| 2 | — | Misuse of shell command / invalid arguments |
| 126 | — | Command not executable (permission denied) |
| 127 | — | Command not found |
| 128 | — | Invalid exit argument |
| 130 | SIGINT | Interrupted (Ctrl+C) |
| 131 | SIGQUIT | Quit (core dump) |
| 134 | SIGABRT | Aborted (e.g. `assert()` failure) |
| 137 | SIGKILL | Killed (OOMKilled or `kill -9`) |
| 139 | SIGSEGV | Segmentation fault |
| 141 | SIGPIPE | Broken pipe |
| 143 | SIGTERM | Terminated gracefully |

> Exit codes 128+N indicate the process was killed by signal N.

---

## 32. Checksums

By default, pods do **NOT** restart when a ConfigMap or Secret changes. Enable opt-in rolling restarts:

```yaml
checksums:
  enabled: true   # adds SHA-256 annotation to pod template → triggers rolling restart on CM/Secret change
```

> **How it works**: When enabled, a `checksum/configmaps` and/or `checksum/secrets` annotation is added to the pod template. Kubernetes detects the annotation change and performs a rolling restart.

### When to use

| Scenario | Recommended |
|---|---|
| App reads config at startup only | ✅ Enable — ensures pods pick up new config |
| App hot-reloads config via inotify / Reloader | ❌ Disable — pods would restart unnecessarily |
| Databases / StatefulSets | ❌ Disable — unexpected restarts are dangerous |
| Use Stakater Reloader instead | ❌ Disable — avoid double-restart |

```yaml
# Opt-in (disabled by default)
checksums:
  enabled: false   # change to true to enable
```

---

## 33. StatefulSet Pod Anti-Affinity

For StatefulSets, spreading replicas across nodes is critical for HA. The `affinity` key works identically for all workload types (Deployment, StatefulSet, DaemonSet).

### Soft (preferred) — recommended for most StatefulSets

Pods *prefer* different nodes but will schedule on the same node if needed:

```yaml
workload:
  type: statefulset
replicaCount: 3

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: myapp   # matches selector labels auto-set by chart
          topologyKey: kubernetes.io/hostname
```

### Hard (required) — for mission-critical databases

Pods *require* different nodes. **Warning**: if you have 3 replicas but only 2 nodes, `pod-2` will be `Pending` forever:

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app.kubernetes.io/name: myapp
        topologyKey: kubernetes.io/hostname
```

### Spread across both nodes AND availability zones

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: myapp
          topologyKey: kubernetes.io/hostname   # different nodes

topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone   # spread across AZs
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: myapp
```

> **Tip**: Use `app.kubernetes.io/name` in `matchLabels` — this is exactly what the chart sets as a selector label. The value equals your `nameOverride` or chart name.

---

## 34. OpenShift SecurityContextConstraints (SCC)

SecurityContextConstraints control the set of conditions that a pod must run with in order to be accepted into the OpenShift system. Use them to lock down pod permissions or allow specific privileges.

### Basic "restricted-custom" SCC

A secure SCC that forces pods to run as non-root and drops most capabilities.

```yaml
scc:
  restricted-custom:
    allowPrivilegedContainer: false
    allowPrivilegeEscalation: false
    requiredDropCapabilities: [ALL]
    runAsUser:
      type: MustRunAsRange
    seLinuxContext:
      type: MustRunAs
    fsGroup:
      type: MustRunAs
    supplementalGroups:
      type: RunAsAny
    volumes: [configMap, downwardAPI, emptyDir, persistentVolumeClaim, projected, secret]
    users:
      - system:serviceaccount:my-namespace:my-sa
```

### Privileged SCC for infrastructure agents

Allows host networking, host storage, and running as any user.

```yaml
scc:
  privileged-custom:
    allowPrivilegedContainer: true
    allowPrivilegeEscalation: true
    runAsUser:
      type: RunAsAny
    seLinuxContext:
      type: RunAsAny
    fsGroup:
      type: RunAsAny
    supplementalGroups:
      type: RunAsAny
    volumes: ["*"] # Allow all volume types
    allowHostNetwork: true
    allowHostPorts: true
    allowHostPID: true
    allowHostIPC: true
    users:
      - system:serviceaccount:my-monitoring-ns:prometheus
```

### Strategy Types for runAsUser/fsGroup/supplementalGroups:

- `MustRunAsRange`: Requires a numeric range (common for OpenShift project defaults).
- `MustRunAs`: Requires a specific UID or value.
- `MustRunAsNonRoot`: Pod must not run as UID 0.
- `RunAsAny`: No restriction.

---

## 35. Config/RBAC-only Releases

`workload.type: none` renders **no** Deployment/StatefulSet/DaemonSet — for a release
that only owns Kubernetes objects with no compute of its own. Typical uses:

- A namespace-shared bundle (ConfigMaps, Secrets, RBAC) referenced by other releases,
  converted from a `shared.yaml` manifest dump.
- A CI/CD service account plus RBAC, with nothing running.
- A cluster-scoped "shared" release for StorageClasses/PVs/SCCs (deployed once per cluster).

```yaml
workload:
  type: none

service:
  enabled: false     # no Service without a workload to back it

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

> **Guardrails**: `hpa.enabled`, `vpa.enabled`, and `pdb.enabled` all **fail validation**
> when combined with `workload.type: none` — there are no pods to scale, resize, or
> protect. Disable them (or leave them unset) for `none` releases.

---

## 36. Multiple Services

The primary `service` key renders exactly one Service. Use the map-based `services`
key for any **additional** Service objects a microservice needs — e.g. an admin-only
port, or a headless Service alongside a normal ClusterIP one. Each entry is rendered
as its own Service named after the map key (no release-name prefix), so name it
something that's unique within the namespace.

```yaml
service:
  enabled: true
  ports:
    http:
      port: 80
      targetPort: http

services:
  # A second, admin-only ClusterIP service pointing at the same pods
  admin:
    enabled: true
    type: ClusterIP
    ports:
      admin-http:
        port: 8081
        targetPort: 8081

  # A headless service for direct pod DNS (e.g. peer discovery)
  headless:
    enabled: true
    clusterIP: None
    publishNotReadyAddresses: true
    ports:
      peer:
        port: 7000

  # Point at a different pod selector than this release's own pods
  legacy-shim:
    enabled: true
    selector:
      app: legacy-app
    ports:
      http:
        port: 80
        targetPort: 8080
```

> Every entry needs its own `enabled: true` — unlike the primary `service`, an entry
> missing from the map (or with `enabled: false`) simply isn't rendered. Only the
> primary `service` defaults its `selector` to this chart's own pod labels; extra
> `services` entries use the chart's selector too unless you set a custom `selector`.

---

## 37. Multiple OpenShift Routes

Same pattern as §36, for OpenShift `Route` objects. The primary `route` key renders
one Route; `routes` is a map for any additional hostnames/paths fronting the same (or
a different) backing Service.

```yaml
route:
  enabled: true
  host: myapp.apps.cluster.example.com
  tls:
    termination: edge

routes:
  admin-console:
    enabled: true
    host: admin.apps.cluster.example.com
    targetPort: admin-http
    serviceName: admin        # defaults to this release's own Service if omitted
    tls:
      termination: passthrough

  legacy-path:
    enabled: true
    host: myapp.apps.cluster.example.com
    path: /legacy
    targetPort: http
```

> `targetPort` defaults to the first port name on the referenced Service, same as the
> primary `route`. `wildcardPolicy` defaults to `None` for every entry.

### Assigning to users or groups

Use the `users` and `groups` arrays inside the SCC definition to specify who can use this SCC. Most commonly, you'll target specific service accounts:

```yaml
scc:
  my-app-scc:
    # ...
    users:
      - system:serviceaccount:<namespace>:<serviceaccount-name>
```
