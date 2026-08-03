#!/usr/bin/env python3
"""
generate_mock_environment.py
=============================
Generates a large, deliberately messy mock "raw OpenShift dump" fixture used
to stress-test convert_to_universal_chart.py:

    namespaces/<namespace>/shared.yaml
    namespaces/<namespace>/<microservice>.yaml   (one per microservice)

5 namespaces x 50 microservices = 250 microservices, covering:

  * stateless web apps (Deployment + Service + Route + ConfigMap + Secret)
  * stateful databases (StatefulSet + volumeClaimTemplates + headless Service)
  * config/RBAC-only microservices with NO compute workload at all
  * networking-heavy microservices (multiple Routes/Services/NetworkPolicies)
  * batch-oriented microservices (CronJobs, standalone Jobs, PVCs, Secrets)
  * DaemonSet node agents
  * one "kitchen sink" per namespace exercising nearly every chart feature
  * realistic OpenShift/API-server noise: resourceVersion, uid, managedFields,
    creationTimestamp, status subresources, cluster-assigned IPs, transient
    ReplicaSet/Pod objects owned by a Deployment, auto-generated SA token /
    dockercfg Secrets, and CronJob-owned Job instances — all of which the
    converter must sanitize away or correctly skip.

It also deliberately plants conflicts for the converter to resolve:

  * two microservices independently declare a ConfigMap named "app-config"
    with DIFFERENT data (private name collision, differing content)
  * two microservices independently declare a ConfigMap named
    "healthcheck-scripts" with IDENTICAL data (private name collision,
    identical content — still requires disambiguation, since two Helm
    releases can never jointly own one Kubernetes object)
  * several microservices re-embed a namespace-shared ConfigMap verbatim
    inside their own file (simulating a raw dump that captured the same
    object twice) — the converter must recognize it as already owned by the
    namespace-shared release and drop the duplicate
  * a StorageClass ("fast-ssd") and an SCC ("restricted-custom-scc") appear,
    byte-identical, in multiple namespaces — a legitimate cluster-scoped
    dedupe, not a conflict
  * a ClusterRole ("cross-namespace-log-reader") appears in two namespaces
    with DIFFERENT rules — a genuine, unresolvable cluster-scope conflict
    that must be surfaced in the report, not silently dropped

Usage:
    python generate_mock_environment.py --output namespaces --seed 42
"""
from __future__ import annotations

import argparse
import base64
import copy
import random
import shutil
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import yaml


# ---------------------------------------------------------------------------
# Low-level noisy-metadata / object builders
# ---------------------------------------------------------------------------

def noisy_meta(namespace, name, labels=None, annotations=None, extra=None) -> dict:
    meta = {"name": name}
    if namespace:
        meta["namespace"] = namespace
    meta["labels"] = labels or {"app.kubernetes.io/name": name}
    ts = (datetime.utcnow() - timedelta(days=random.randint(1, 400))).strftime("%Y-%m-%dT%H:%M:%SZ")
    ann = {"kubectl.kubernetes.io/last-applied-configuration": '{"apiVersion":"v1","kind":"redacted"}'}
    if annotations:
        ann.update(annotations)
    meta["annotations"] = ann
    meta["uid"] = str(uuid.uuid4())
    meta["resourceVersion"] = str(random.randint(100000, 9999999))
    meta["generation"] = random.randint(1, 12)
    meta["creationTimestamp"] = ts
    meta["managedFields"] = [{"manager": "kubectl-client-side-apply", "operation": "Update",
                              "apiVersion": "v1", "time": ts, "fieldsType": "FieldsV1"}]
    if extra:
        meta.update(extra)
    return meta


def default_container(name, *, image=None, port=8080, env=None, envFrom=None,
                      resources=None, volumeMounts=None, command=None):
    c = {
        "name": name,
        "image": image or f"registry.example.com/{name}:{random.choice(['1.0.0', '2.3.1', 'latest', 'v3.2.0'])}",
        "imagePullPolicy": "IfNotPresent",
        "terminationMessagePath": "/dev/termination-log",
        "terminationMessagePolicy": "File",
        "resources": resources or {"requests": {"cpu": "100m", "memory": "128Mi"},
                                    "limits": {"cpu": "500m", "memory": "512Mi"}},
    }
    if port is not None:
        c["ports"] = [{"name": "http", "containerPort": port, "protocol": "TCP"}]
        c["readinessProbe"] = {"httpGet": {"path": "/healthz", "port": "http"}, "initialDelaySeconds": 5, "periodSeconds": 10}
        c["livenessProbe"] = {"httpGet": {"path": "/healthz", "port": "http"}, "initialDelaySeconds": 15, "periodSeconds": 20}
    if env:
        c["env"] = env
    if envFrom:
        c["envFrom"] = envFrom
    if volumeMounts:
        c["volumeMounts"] = volumeMounts
    if command:
        c["command"] = command
    return c


def deployment(ns, name, *, replicas=2, containers=None, sa=None, extra_pod_spec=None):
    containers = containers or [default_container(name)]
    pod_spec = {"containers": containers, "restartPolicy": "Always", "terminationGracePeriodSeconds": 30,
                "dnsPolicy": "ClusterFirst", "schedulerName": "default-scheduler"}
    if sa:
        pod_spec["serviceAccountName"] = sa
    if extra_pod_spec:
        pod_spec.update(extra_pod_spec)
    return {
        "apiVersion": "apps/v1", "kind": "Deployment",
        "metadata": noisy_meta(ns, name),
        "spec": {
            "replicas": replicas, "revisionHistoryLimit": 10,
            "selector": {"matchLabels": {"app": name}},
            "strategy": {"type": "RollingUpdate", "rollingUpdate": {"maxSurge": "25%", "maxUnavailable": "25%"}},
            "template": {"metadata": {"labels": {"app": name, "app.kubernetes.io/name": name}}, "spec": pod_spec},
        },
        "status": {"replicas": replicas, "readyReplicas": replicas, "availableReplicas": replicas,
                   "observedGeneration": random.randint(1, 10)},
    }


def statefulset(ns, name, *, replicas=3, containers=None, vcts=None, sa=None):
    containers = containers or [default_container(name)]
    pod_spec = {"containers": containers, "restartPolicy": "Always", "terminationGracePeriodSeconds": 30}
    if sa:
        pod_spec["serviceAccountName"] = sa
    return {
        "apiVersion": "apps/v1", "kind": "StatefulSet",
        "metadata": noisy_meta(ns, name),
        "spec": {
            "serviceName": name, "replicas": replicas, "revisionHistoryLimit": 10,
            "podManagementPolicy": "OrderedReady",
            "selector": {"matchLabels": {"app": name}},
            "updateStrategy": {"type": "RollingUpdate"},
            "template": {"metadata": {"labels": {"app": name}}, "spec": pod_spec},
            "volumeClaimTemplates": vcts or [],
        },
        "status": {"replicas": replicas, "readyReplicas": replicas},
    }


def vct(name, size="20Gi", storage_class=None):
    spec = {"accessModes": ["ReadWriteOnce"], "resources": {"requests": {"storage": size}}}
    if storage_class:
        spec["storageClassName"] = storage_class
    return {"metadata": {"name": name}, "spec": spec, "status": {"phase": "Bound"}}


def daemonset(ns, name, containers, sa=None):
    pod_spec = {"containers": containers, "restartPolicy": "Always", "terminationGracePeriodSeconds": 30,
                "tolerations": [{"operator": "Exists"}]}
    if sa:
        pod_spec["serviceAccountName"] = sa
    return {
        "apiVersion": "apps/v1", "kind": "DaemonSet",
        "metadata": noisy_meta(ns, name),
        "spec": {
            "revisionHistoryLimit": 10, "selector": {"matchLabels": {"app": name}},
            "updateStrategy": {"type": "RollingUpdate", "rollingUpdate": {"maxUnavailable": 1}},
            "template": {"metadata": {"labels": {"app": name}}, "spec": pod_spec},
        },
        "status": {"desiredNumberScheduled": 3, "numberReady": 3},
    }


def service(ns, name, *, target=None, port=80, target_port="http", svc_type="ClusterIP", headless=False):
    spec = {"type": svc_type, "ports": [{"name": "http", "port": port, "targetPort": target_port, "protocol": "TCP"}],
            "selector": {"app": target or name}, "sessionAffinity": "None"}
    if headless:
        spec["clusterIP"] = "None"
    else:
        ip = f"172.30.{random.randint(0, 255)}.{random.randint(1, 254)}"
        spec["clusterIP"] = ip
        spec["clusterIPs"] = [ip]
    return {"apiVersion": "v1", "kind": "Service", "metadata": noisy_meta(ns, name),
            "spec": spec, "status": {"loadBalancer": {}}}


def route(ns, name, *, to=None, target_port="http", host=None, tls=True):
    host = host or f"{name}.apps.cluster-generated.local"
    spec = {"to": {"kind": "Service", "name": to or name, "weight": 100},
            "port": {"targetPort": target_port}, "host": host, "wildcardPolicy": "None"}
    if tls:
        spec["tls"] = {"termination": "edge", "insecureEdgeTerminationPolicy": "Redirect"}
    return {"apiVersion": "route.openshift.io/v1", "kind": "Route", "metadata": noisy_meta(ns, name),
            "spec": spec, "status": {"ingress": [{"host": host, "routerName": "default"}]}}


def configmap(ns, name, data, labels=None):
    return {"apiVersion": "v1", "kind": "ConfigMap", "metadata": noisy_meta(ns, name, labels=labels), "data": data}


def secret(ns, name, *, string_data=None, data=None, type_="Opaque"):
    doc = {"apiVersion": "v1", "kind": "Secret", "metadata": noisy_meta(ns, name), "type": type_}
    if data:
        doc["data"] = data
    elif string_data:
        doc["data"] = {k: base64.b64encode(v.encode()).decode() for k, v in string_data.items()}
    return doc


def pvc(ns, name, *, size="10Gi", modes=None, storage_class=None):
    spec = {"accessModes": modes or ["ReadWriteOnce"], "resources": {"requests": {"storage": size}}}
    if storage_class:
        spec["storageClassName"] = storage_class
    return {"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": noisy_meta(ns, name),
            "spec": spec, "status": {"phase": "Bound", "capacity": {"storage": size}}}


def serviceaccount(ns, name, *, auto_secrets=True):
    doc = {"apiVersion": "v1", "kind": "ServiceAccount", "metadata": noisy_meta(ns, name),
           "automountServiceAccountToken": True}
    if auto_secrets:
        doc["secrets"] = [{"name": f"{name}-token-a1b2c"}, {"name": f"{name}-dockercfg-x9z8y"}]
        doc["imagePullSecrets"] = [{"name": f"{name}-dockercfg-x9z8y"}]
    return doc


def role(ns, name, rules):
    return {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "Role", "metadata": noisy_meta(ns, name), "rules": rules}


def rolebinding(ns, name, role_name, sa_name):
    return {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "RoleBinding", "metadata": noisy_meta(ns, name),
            "roleRef": {"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": role_name},
            "subjects": [{"kind": "ServiceAccount", "name": sa_name, "namespace": ns}]}


def clusterrole(name, rules):
    return {"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "ClusterRole", "metadata": noisy_meta(None, name), "rules": rules}


def storageclass_doc(name):
    return {"apiVersion": "storage.k8s.io/v1", "kind": "StorageClass", "metadata": noisy_meta(None, name),
            "provisioner": "ebs.csi.aws.com", "reclaimPolicy": "Delete",
            "volumeBindingMode": "WaitForFirstConsumer", "allowVolumeExpansion": True,
            "parameters": {"type": "gp3", "encrypted": "true"}}


def scc_doc(name):
    return {"apiVersion": "security.openshift.io/v1", "kind": "SecurityContextConstraints",
            "metadata": noisy_meta(None, name),
            "allowPrivilegedContainer": False, "allowPrivilegeEscalation": False,
            "requiredDropCapabilities": ["ALL"], "runAsUser": {"type": "MustRunAsRange"},
            "seLinuxContext": {"type": "MustRunAs"}, "fsGroup": {"type": "MustRunAs"},
            "supplementalGroups": {"type": "RunAsAny"},
            "volumes": ["configMap", "downwardAPI", "emptyDir", "persistentVolumeClaim", "projected", "secret"],
            "users": ["system:serviceaccount:platform-shared:scc-user"]}


def networkpolicy(ns, name, pod_selector, policy_types, ingress=None, egress=None):
    spec = {"podSelector": pod_selector, "policyTypes": policy_types}
    if ingress:
        spec["ingress"] = ingress
    if egress:
        spec["egress"] = egress
    return {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": noisy_meta(ns, name), "spec": spec}


def cronjob(ns, name, schedule, containers):
    return {"apiVersion": "batch/v1", "kind": "CronJob", "metadata": noisy_meta(ns, name),
            "spec": {"schedule": schedule, "concurrencyPolicy": "Forbid",
                     "successfulJobsHistoryLimit": 3, "failedJobsHistoryLimit": 1,
                     "jobTemplate": {"spec": {"backoffLimit": 2, "template": {
                         "metadata": {"labels": {"app": name}},
                         "spec": {"restartPolicy": "OnFailure", "containers": containers}}}}},
            "status": {}}


def job(ns, name, containers, *, owner_cronjob=None):
    doc = {"apiVersion": "batch/v1", "kind": "Job", "metadata": noisy_meta(ns, name),
           "spec": {"backoffLimit": 3, "template": {"metadata": {"labels": {"app": name}},
                    "spec": {"restartPolicy": "Never", "containers": containers}}},
           "status": {"succeeded": 1}}
    if owner_cronjob:
        doc["metadata"]["ownerReferences"] = [
            {"apiVersion": "batch/v1", "kind": "CronJob", "name": owner_cronjob, "controller": True}]
    return doc


def replicaset_noise(ns, deploy_name):
    rs_name = f"{deploy_name}-{random.randint(1000000000, 9999999999)}"
    return {"apiVersion": "apps/v1", "kind": "ReplicaSet",
            "metadata": noisy_meta(ns, rs_name, extra={"ownerReferences": [
                {"apiVersion": "apps/v1", "kind": "Deployment", "name": deploy_name, "controller": True}]}),
            "spec": {"replicas": 1, "selector": {"matchLabels": {"app": deploy_name}},
                     "template": {"metadata": {"labels": {"app": deploy_name}}, "spec": {"containers": []}}},
            "status": {"replicas": 1}}


def pod_noise(ns, deploy_name):
    suffix = f"{random.randint(10000, 99999)}-{random.choice('abcdefghjkmnpqrstv')}{random.choice('abcdefghjkmnpqrstv')}xyz"
    pod_name = f"{deploy_name}-{suffix}"
    return {"apiVersion": "v1", "kind": "Pod",
            "metadata": noisy_meta(ns, pod_name, extra={"ownerReferences": [
                {"apiVersion": "apps/v1", "kind": "ReplicaSet", "name": f"{deploy_name}-rs", "controller": True}]}),
            "spec": {"containers": [{"name": deploy_name, "image": "registry.example.com/placeholder:latest"}]},
            "status": {"phase": "Running"}}


def hpa(ns, name, *, min_r=2, max_r=6):
    return {"apiVersion": "autoscaling/v2", "kind": "HorizontalPodAutoscaler", "metadata": noisy_meta(ns, name),
            "spec": {"scaleTargetRef": {"apiVersion": "apps/v1", "kind": "Deployment", "name": name},
                     "minReplicas": min_r, "maxReplicas": max_r,
                     "metrics": [{"type": "Resource", "resource": {"name": "cpu",
                                 "target": {"type": "Utilization", "averageUtilization": 70}}}]}}


def pdb(ns, name, *, min_available=1):
    return {"apiVersion": "policy/v1", "kind": "PodDisruptionBudget", "metadata": noisy_meta(ns, name),
            "spec": {"selector": {"matchLabels": {"app": name}}, "minAvailable": min_available}}


def write_multidoc(path: Path, docs: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump_all(docs, sort_keys=False, default_flow_style=False, width=100), encoding="utf-8")


# ---------------------------------------------------------------------------
# Archetypes
# ---------------------------------------------------------------------------

def gen_stateless_web(ns, name):
    docs = []
    port = random.choice([8080, 8000, 3000, 9000])
    sa_name = f"{name}-sa"
    docs.append(serviceaccount(ns, sa_name))
    env = [
        {"name": "APP_ENV", "value": random.choice(["production", "staging"])},
        {"name": "LOG_LEVEL", "valueFrom": {"configMapKeyRef": {"name": "logging-defaults", "key": "LOG_LEVEL"}}},
    ]
    envFrom = [{"secretRef": {"name": f"{name}-secret"}}]
    container = default_container(name, port=port, env=env, envFrom=envFrom)
    docs.append(deployment(ns, name, replicas=random.choice([1, 2, 3]), containers=[container], sa=sa_name))
    docs.append(replicaset_noise(ns, name))
    docs.append(pod_noise(ns, name))
    docs.append(service(ns, name, target=name))
    docs.append(configmap(ns, f"{name}-config",
                          {"MAX_CONNECTIONS": str(random.choice([50, 100, 200])),
                           "FEATURE_FLAG_BETA": random.choice(["true", "false"])}))
    docs.append(secret(ns, f"{name}-secret", string_data={"API_KEY": uuid.uuid4().hex}))
    if random.random() < 0.4:
        docs.append(route(ns, name, to=name))
    if random.random() < 0.3:
        docs.append(hpa(ns, name, min_r=2, max_r=8))
    if random.random() < 0.2:
        docs.append(pdb(ns, name, min_available=1))
    return docs


def gen_stateful_db(ns, name):
    docs = []
    sa_name = f"{name}-sa"
    docs.append(serviceaccount(ns, sa_name))
    container = default_container(name, port=5432, volumeMounts=[{"name": "data", "mountPath": "/var/lib/data"}])
    docs.append(statefulset(ns, name, replicas=random.choice([1, 3]), containers=[container],
                            vcts=[vct("data", size=random.choice(["20Gi", "50Gi"]), storage_class="fast-ssd")], sa=sa_name))
    docs.append(service(ns, name, target=name, headless=True))
    docs.append(secret(ns, f"{name}-creds", string_data={"DB_USER": "admin", "DB_PASSWORD": uuid.uuid4().hex}))
    docs.append(storageclass_doc("fast-ssd"))
    return docs


def gen_no_workload_config(ns, name):
    docs = []
    sa1, sa2 = f"{name}-reader", f"{name}-writer"
    docs.append(serviceaccount(ns, sa1))
    docs.append(serviceaccount(ns, sa2, auto_secrets=False))
    role_name = f"{name}-role"
    docs.append(role(ns, role_name, [{"apiGroups": [""], "resources": ["configmaps", "secrets"], "verbs": ["get", "list", "watch"]}]))
    docs.append(rolebinding(ns, f"{name}-rb", role_name, sa1))
    docs.append(configmap(ns, f"{name}-settings", {"MODE": "readonly", "RETENTION_DAYS": "30"}))
    docs.append(configmap(ns, f"{name}-feature-flags", {"NEW_UI": "false"}))
    return docs


def gen_networking_heavy(ns, name):
    docs = []
    container = default_container(name, port=8080)
    docs.append(deployment(ns, name, replicas=2, containers=[container]))
    docs.append(service(ns, name, target=name))
    docs.append(service(ns, f"{name}-admin", target=name, port=8081, target_port="http"))
    docs.append(route(ns, name, to=name, host=f"{name}.apps.example.com"))
    docs.append(route(ns, f"{name}-admin-console", to=f"{name}-admin", host=f"{name}-admin.apps.example.com"))
    docs.append(networkpolicy(ns, f"{name}-allow-ingress", {"matchLabels": {"app": name}}, ["Ingress"],
                              ingress=[{"from": [{"podSelector": {"matchLabels": {"tier": "frontend"}}}],
                                        "ports": [{"protocol": "TCP", "port": 8080}]}]))
    docs.append(networkpolicy(ns, f"{name}-deny-egress-external", {"matchLabels": {"app": name}}, ["Egress"],
                              egress=[{"ports": [{"port": 53, "protocol": "UDP"}]}]))
    return docs


def gen_batch_jobs(ns, name, *, with_trigger_api=False):
    docs = []
    backup_c = default_container(f"{name}-backup", port=None,
                                 command=["/bin/sh", "-c", "pg_dump $DATABASE_URL | gzip > /backup/$(date +%Y%m%d).sql.gz"],
                                 envFrom=[{"secretRef": {"name": f"{name}-db-secret"}}])
    docs.append(cronjob(ns, f"{name}-backup", "0 2 * * *", [backup_c]))
    cleanup_c = default_container(f"{name}-cleanup", port=None, command=["python", "manage.py", "clearsessions"])
    docs.append(cronjob(ns, f"{name}-cleanup", "*/15 * * * *", [cleanup_c]))
    migrate_c = default_container(f"{name}-migrate", port=None, command=["python", "manage.py", "migrate"])
    docs.append(job(ns, f"{name}-migrate", [migrate_c]))
    docs.append(job(ns, f"{name}-backup-29384756", [backup_c], owner_cronjob=f"{name}-backup"))  # transient
    docs.append(pvc(ns, f"{name}-backups", size="100Gi"))
    docs.append(secret(ns, f"{name}-db-secret", string_data={"DATABASE_URL": f"postgres://user:pass@{name}-db:5432/app"}))
    if with_trigger_api:
        docs.append(deployment(ns, name, replicas=1, containers=[default_container(name, port=8080)]))
        docs.append(service(ns, name, target=name))
    return docs


def gen_daemonset_agent(ns, name):
    docs = []
    sa_name = f"{name}-sa"
    docs.append(serviceaccount(ns, sa_name))
    container = default_container(name, port=9100, resources={"requests": {"cpu": "20m", "memory": "32Mi"},
                                                               "limits": {"cpu": "100m", "memory": "128Mi"}})
    docs.append(daemonset(ns, name, [container], sa=sa_name))
    docs.append(configmap(ns, f"{name}-config", {"SCRAPE_INTERVAL": "15s"}))
    return docs


def gen_shared_sa_consumer(ns, name):
    """A microservice that runs as the namespace-shared ServiceAccount and
    declares NO ServiceAccount object of its own — pure consumer, no owner."""
    docs = []
    container = default_container(name, port=8080)
    docs.append(deployment(ns, name, replicas=1, containers=[container], sa="namespace-deployer"))
    docs.append(service(ns, name, target=name))
    return docs


def gen_role_collision(ns, name, rules):
    """Declares a Role/RoleBinding under a name that another microservice in
    the same namespace also declares privately (not via shared.yaml)."""
    docs = []
    sa_name = f"{name}-sa"
    docs.append(serviceaccount(ns, sa_name))
    docs.append(role(ns, "audit-role", rules))
    docs.append(rolebinding(ns, f"{name}-audit-rb", "audit-role", sa_name))
    docs.append(configmap(ns, f"{name}-audit-settings", {"AUDIT_ENABLED": "true"}))
    return docs


def gen_sa_collision(ns, name):
    """Declares a ServiceAccount under a name another microservice also
    privately declares, and actually runs a pod under it — exercises both
    the RoleBinding-subject remap and the pod serviceAccountName remap."""
    docs = []
    docs.append(serviceaccount(ns, "worker-sa"))
    docs.append(role(ns, f"{name}-role", [{"apiGroups": [""], "resources": ["pods"], "verbs": ["get"]}]))
    docs.append(rolebinding(ns, f"{name}-rb", f"{name}-role", "worker-sa"))
    container = default_container(name, port=8080)
    docs.append(deployment(ns, name, replicas=1, containers=[container], sa="worker-sa"))
    docs.append(service(ns, name, target=name))
    return docs


def gen_kitchen_sink(ns, name, shared_by_name):
    docs = []
    sa_name = f"{name}-sa"
    docs.append(serviceaccount(ns, sa_name))
    container = default_container(
        name, port=8080,
        env=[{"name": "APP_MODE", "value": "full"}],
        envFrom=[{"secretRef": {"name": f"{name}-secret"}}, {"configMapRef": {"name": "logging-defaults"}}],
        volumeMounts=[{"name": "data", "mountPath": "/data"}, {"name": "cfg", "mountPath": "/etc/app"}],
    )
    docs.append(deployment(ns, name, replicas=2, containers=[container], sa=sa_name, extra_pod_spec={
        "volumes": [{"name": "data", "persistentVolumeClaim": {"claimName": f"{name}-data"}},
                    {"name": "cfg", "configMap": {"name": f"{name}-config"}}],
    }))
    docs.append(replicaset_noise(ns, name))
    docs.append(service(ns, name, target=name))
    docs.append(service(ns, f"{name}-metrics", target=name, port=9090, target_port="http"))
    docs.append(route(ns, name, to=name))
    docs.append(route(ns, f"{name}-alt", to=f"{name}-metrics", host=f"{name}-metrics.apps.example.com"))
    docs.append(configmap(ns, f"{name}-config", {"FEATURE_ALL": "true"}))
    docs.append(secret(ns, f"{name}-secret", string_data={"TOKEN": uuid.uuid4().hex}))
    docs.append(pvc(ns, f"{name}-data", size="30Gi"))
    docs.append(hpa(ns, name, min_r=2, max_r=10))
    docs.append(pdb(ns, name, min_available=1))
    docs.append(networkpolicy(ns, f"{name}-net", {"matchLabels": {"app": name}}, ["Ingress", "Egress"]))
    docs.append(role(ns, f"{name}-role", [{"apiGroups": [""], "resources": ["pods"], "verbs": ["get", "list"]}]))
    docs.append(rolebinding(ns, f"{name}-rb", f"{name}-role", sa_name))
    if "namespace-ca-bundle" in shared_by_name:
        docs.append(copy.deepcopy(shared_by_name["namespace-ca-bundle"]))
    return docs


# ---------------------------------------------------------------------------
# Namespace assembly
# ---------------------------------------------------------------------------

def build_namespace(ns_name, output_root: Path, *, clusterrole_variant=None, include_scc=False) -> int:
    ns_dir = output_root / ns_name

    shared_docs = [
        configmap(ns_name, "namespace-ca-bundle",
                 {"ca.crt": "-----BEGIN CERTIFICATE-----\nMIIBFAKECERTDATA==\n-----END CERTIFICATE-----\n"}),
        configmap(ns_name, "logging-defaults", {"LOG_LEVEL": "info", "LOG_FORMAT": "json"}),
        secret(ns_name, "registry-pull-creds", data={".dockerconfigjson": base64.b64encode(b'{"auths":{}}').decode()},
              type_="kubernetes.io/dockerconfigjson"),
        secret(ns_name, "shared-db-creds", string_data={"DATABASE_URL": f"postgres://svc:pass@{ns_name}-shared-db:5432/platform"}),
        serviceaccount(ns_name, "namespace-deployer"),
        role(ns_name, "namespace-viewer", [{"apiGroups": [""], "resources": ["configmaps"], "verbs": ["get", "list"]}]),
        rolebinding(ns_name, "namespace-viewer-binding", "namespace-viewer", "namespace-deployer"),
        networkpolicy(ns_name, "default-deny-all", {}, ["Ingress", "Egress"]),
        storageclass_doc("fast-ssd"),
    ]
    if clusterrole_variant == "a":
        shared_docs.append(clusterrole("cross-namespace-log-reader",
                           [{"apiGroups": [""], "resources": ["pods", "pods/log"], "verbs": ["get", "list"]}]))
    elif clusterrole_variant == "b":
        shared_docs.append(clusterrole("cross-namespace-log-reader",
                           [{"apiGroups": [""], "resources": ["pods", "pods/log", "events"], "verbs": ["get", "list", "watch"]}]))
    if include_scc:
        shared_docs.append(scc_doc("restricted-custom-scc"))

    shared_by_name = {d["metadata"]["name"]: d for d in shared_docs if d.get("kind") in ("ConfigMap", "Secret")}
    write_multidoc(ns_dir / "shared.yaml", shared_docs)

    microservices: dict[str, list[dict]] = {}

    ks_name = f"{ns_name}-gateway"
    microservices[ks_name] = gen_kitchen_sink(ns_name, ks_name, shared_by_name)

    for i in range(1, 4):
        n = f"{ns_name}-config-only-{i}"
        microservices[n] = gen_no_workload_config(ns_name, n)

    for i in range(1, 4):
        n = f"{ns_name}-edge-{i}"
        microservices[n] = gen_networking_heavy(ns_name, n)

    for i, with_api in enumerate([False, False, True], start=1):
        n = f"{ns_name}-batch-{i}"
        microservices[n] = gen_batch_jobs(ns_name, n, with_trigger_api=with_api)

    for i in range(1, 3):
        n = f"{ns_name}-agent-{i}"
        microservices[n] = gen_daemonset_agent(ns_name, n)

    for i in range(1, 3):
        n = f"{ns_name}-db-{i}"
        microservices[n] = gen_stateful_db(ns_name, n)

    # Private collision fixtures: DIFFERING content under the same name
    coll_a, coll_b = f"{ns_name}-checkout", f"{ns_name}-billing"
    microservices[coll_a] = gen_stateless_web(ns_name, coll_a)
    microservices[coll_a].append(configmap(ns_name, "app-config", {"FEATURE_X": "on"}))
    microservices[coll_b] = gen_stateless_web(ns_name, coll_b)
    microservices[coll_b].append(configmap(ns_name, "app-config", {"FEATURE_X": "off", "EXTRA": "1"}))

    # Private collision fixtures: IDENTICAL content under the same name
    ident_a, ident_b = f"{ns_name}-alpha", f"{ns_name}-beta"
    healthcheck_data = {"healthcheck.sh": "#!/bin/sh\ncurl -f http://localhost:8080/health\n"}
    microservices[ident_a] = gen_stateless_web(ns_name, ident_a)
    microservices[ident_a].append(configmap(ns_name, "healthcheck-scripts", dict(healthcheck_data)))
    microservices[ident_b] = gen_stateless_web(ns_name, ident_b)
    microservices[ident_b].append(configmap(ns_name, "healthcheck-scripts", dict(healthcheck_data)))

    # Raw-dump duplication of a namespace-shared resource
    for n in (f"{ns_name}-notify-1", f"{ns_name}-notify-2"):
        docs = gen_stateless_web(ns_name, n)
        docs.append(copy.deepcopy(shared_by_name["namespace-ca-bundle"]))
        microservices[n] = docs

    # Pure consumer of the namespace-shared ServiceAccount (declares none of its own)
    n = f"{ns_name}-shared-runner"
    microservices[n] = gen_shared_sa_consumer(ns_name, n)

    # Private Role name collision ("audit-role"), same rules -> RoleBinding.roleRef remap
    audit_rules = [{"apiGroups": [""], "resources": ["events"], "verbs": ["get", "list"]}]
    role_a, role_b = f"{ns_name}-scanner-a", f"{ns_name}-scanner-b"
    microservices[role_a] = gen_role_collision(ns_name, role_a, audit_rules)
    microservices[role_b] = gen_role_collision(ns_name, role_b, audit_rules)

    # Private ServiceAccount name collision ("worker-sa") -> RoleBinding subject +
    # pod serviceAccountName remap
    sa_a, sa_b = f"{ns_name}-worker-a", f"{ns_name}-worker-b"
    microservices[sa_a] = gen_sa_collision(ns_name, sa_a)
    microservices[sa_b] = gen_sa_collision(ns_name, sa_b)

    target_total = 50
    idx = 1
    while len(microservices) < target_total:
        n = f"{ns_name}-svc-{idx:02d}"
        idx += 1
        if n in microservices:
            continue
        archetype = random.choices(
            ["stateless_web", "stateful_db", "networking_heavy", "batch_jobs", "daemonset_agent"],
            weights=[60, 12, 10, 10, 8],
        )[0]
        if archetype == "stateless_web":
            microservices[n] = gen_stateless_web(ns_name, n)
        elif archetype == "stateful_db":
            microservices[n] = gen_stateful_db(ns_name, n)
        elif archetype == "networking_heavy":
            microservices[n] = gen_networking_heavy(ns_name, n)
        elif archetype == "batch_jobs":
            microservices[n] = gen_batch_jobs(ns_name, n)
        else:
            microservices[n] = gen_daemonset_agent(ns_name, n)

    for n, docs in microservices.items():
        write_multidoc(ns_dir / f"{n}.yaml", docs)

    return len(microservices)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", default="namespaces")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    output_root = Path(args.output)
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True)

    namespaces = ["payments-svc", "identity-svc", "logistics-svc", "analytics-svc", "platform-ops"]
    totals = {}
    for i, ns in enumerate(namespaces):
        clusterrole_variant = "a" if i == 0 else ("b" if i == 1 else None)
        include_scc = i in (0, 2)
        count = build_namespace(ns, output_root, clusterrole_variant=clusterrole_variant, include_scc=include_scc)
        totals[ns] = count
        print(f"  {ns}: {count} microservices + shared.yaml")

    print(f"\nGenerated {sum(totals.values())} microservices across {len(namespaces)} namespaces under {output_root}/")


if __name__ == "__main__":
    main()
