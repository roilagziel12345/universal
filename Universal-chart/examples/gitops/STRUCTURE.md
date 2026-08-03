# GitOps Repo: layered values best practice
#
# Concept: Argo CD merges valueFiles in order.
# Each layer ONLY has what's different from the layer above it.
#
# apps/
# ├── _base/                        # shared defaults for all apps
# │   ├── defaults.yaml             # chart-level defaults (resources, probes, etc.)
# │   └── apps/
# │       ├── frontend.yaml         # app identity (image, ports, service type)
# │       ├── backend.yaml
# │       └── worker.yaml
# ├── env/
# │   ├── dev/
# │   │   ├── env.yaml              # dev-wide: low resources, debug flags
# │   │   └── clusters/
# │   │       ├── mng-1/
# │   │       │   ├── cluster.yaml  # cluster-specific: storageClass, domain
# │   │       │   └── apps/
# │   │       │       ├── frontend.yaml   # only what's different on mng-1/dev
# │   │       │       ├── backend.yaml
# │   │       │       └── worker.yaml
# │   │       ├── mng-2/ ...
# │   │       └── mng-3/ ...
# │   ├── int/ ...
# │   └── prod/ ...
# └── applicationset.yaml           # Argo CD wires it all together
#
# Argo CD merges valueFiles IN ORDER (later files win):
#   1. _base/defaults.yaml           (global defaults)
#   2. _base/apps/<app>.yaml         (app base identity)
#   3. env/<ENV>/env.yaml            (env-wide settings)
#   4. env/<ENV>/clusters/<CLUSTER>/cluster.yaml     (cluster settings)
#   5. env/<ENV>/clusters/<CLUSTER>/apps/<app>.yaml  (app+env+cluster diff)
