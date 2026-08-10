#!/usr/bin/env python3
"""
values_editor.py
=================
A values-authoring/editing CLI for the Universal Chart, built on top of the
layered defaults.yaml system convert_to_universal_chart.py produces (see
that script's docstring and gitops-factory/README.md's "defaults.yaml —
factoring out what's common" section for the full layering rationale).

Operates on ONE APP's output tree — what one convert_to_universal_chart.py
--output run produces, i.e. what gets pushed to that app's own Git repo:

    <app-dir>/
      defaults.yaml                        # global, this app's whole run
      <namespace>/
        defaults.yaml                      # this namespace only
        values/<microservice>-values.yaml
        values-minimal/<microservice>-values-minimal.yaml
        releases/<microservice>.yaml

Commands
--------
    list        List every namespace + microservice under an app-dir.
    show        Print the fully-merged EFFECTIVE values for one microservice
                (global defaults -> namespace defaults -> values -> minimal),
                i.e. exactly what would be deployed — the same layering
                order the generated ApplicationSet uses.
    new         Scaffold a brand-new microservice's values/values-minimal/
                releases files. Anything you set that's already identical to
                what the app's global or namespace defaults.yaml already
                supplies is reported and OMITTED, so you never hand-author
                a duplicate of something a lower layer already covers.
    set         Patch a single dotted-path key on an EXISTING microservice.
                Routes image.tag / literal-value env automatically to the
                minimal file, matching the split convert_to_universal_chart.py
                itself uses — everything else goes to the comprehensive file.
    validate    Validate every microservice's merged effective values against
                the chart's values.schema.json, and (with --chart) also
                render each one for real with `helm template` to catch
                errors the schema can't (missing required combinations,
                template bugs, etc.) — same idea as the converter's own
                render-verification step, just for hand-authored values.

Usage
-----
    python values_editor.py list --app-dir output/payments-app
    python values_editor.py show --app-dir output/payments-app --namespace dev --name checkout
    python values_editor.py new  --app-dir output/payments-app --namespace dev --name checkout \\
        --image my-registry/checkout:1.0.0 --port http:8080 \\
        --service-port http:80:http --route-host checkout-dev.apps.example.com \\
        --cpu-request 100m --mem-request 128Mi --cpu-limit 500m --mem-limit 256Mi
    python values_editor.py set --app-dir output/payments-app --namespace dev --name checkout \\
        --key resources.limits.memory --value 512Mi
    python values_editor.py validate --app-dir output/payments-app --chart ../Universal-chart
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

import yaml

from convert_to_universal_chart import (  # noqa: E402  (reuse, never redefine)
    DEFAULTS_FILE_NAME,
    RELEASES_DIR_NAME,
    VALUES_DIR_NAME,
    VALUES_MINIMAL_DIR_NAME,
    dump_yaml,
    split_image,
    subtract_defaults,
)

# ---------------------------------------------------------------------------
# Layer I/O
# ---------------------------------------------------------------------------

def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def deep_merge(base: dict, override: dict) -> dict:
    """
    Recursively merges `override` into `base` (override wins) — matches
    Helm's own values-merging semantics: dicts merge key-by-key, everything
    else (including lists) is replaced wholesale, not concatenated.
    """
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def namespace_dirs(app_dir: Path) -> list[Path]:
    skip = {"applicationsets", "report", "cluster-shared"}
    return sorted(p for p in app_dir.iterdir() if p.is_dir() and p.name not in skip)


def load_layers(app_dir: Path, namespace: str) -> tuple[dict, dict]:
    """Returns (global_defaults, namespace_defaults)."""
    global_defaults = load_yaml(app_dir / DEFAULTS_FILE_NAME)
    ns_defaults = load_yaml(app_dir / namespace / DEFAULTS_FILE_NAME)
    return global_defaults, ns_defaults


def microservice_paths(app_dir: Path, namespace: str, name: str) -> tuple[Path, Path, Path]:
    ns_dir = app_dir / namespace
    values_path = ns_dir / VALUES_DIR_NAME / f"{name}-values.yaml"
    minimal_path = ns_dir / VALUES_MINIMAL_DIR_NAME / f"{name}-values-minimal.yaml"
    release_path = ns_dir / RELEASES_DIR_NAME / f"{name}.yaml"
    return values_path, minimal_path, release_path


def effective_values(app_dir: Path, namespace: str, name: str) -> dict:
    global_defaults, ns_defaults = load_layers(app_dir, namespace)
    values_path, minimal_path, _ = microservice_paths(app_dir, namespace, name)
    values = load_yaml(values_path)
    minimal = load_yaml(minimal_path)
    merged = deep_merge(global_defaults, ns_defaults)
    merged = deep_merge(merged, values)
    merged = deep_merge(merged, minimal)
    return merged


# ---------------------------------------------------------------------------
# Dotted-path get/set, with type inference via YAML (so "80" -> int 80,
# "true" -> bool True, "a,b" stays a plain string, "[a,b]"/"{a: 1}" -> a
# real list/dict — same trick used by lots of CLI --set flags).
# ---------------------------------------------------------------------------

def parse_scalar(raw: str) -> Any:
    try:
        return yaml.safe_load(raw)
    except yaml.YAMLError:
        return raw


def set_path(d: dict, dotted_path: str, value: Any) -> None:
    parts = dotted_path.split(".")
    cur = d
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
        if not isinstance(cur, dict):
            raise ValueError(f"Cannot descend into '{part}' of '{dotted_path}' — it's not a mapping")
    cur[parts[-1]] = value


def get_path(d: dict, dotted_path: str) -> Any:
    cur: Any = d
    for part in dotted_path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def is_minimal_path(dotted_path: str, value: Any) -> bool:
    """
    Mirrors handle_main_container's split in convert_to_universal_chart.py:
    image.tag and literal-value (not valueFrom) env vars belong in the
    minimal file exclusively; everything else belongs in the comprehensive
    file.
    """
    if dotted_path == "image.tag":
        return True
    if dotted_path.startswith("env.") and dotted_path.endswith(".value"):
        return True
    return False


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_list(args: argparse.Namespace) -> None:
    app_dir = Path(args.app_dir)
    if not app_dir.is_dir():
        sys.exit(f"App directory not found: {app_dir}")
    global_defaults = load_yaml(app_dir / DEFAULTS_FILE_NAME)
    print(f"{app_dir}  (global defaults.yaml: {len(global_defaults)} top-level key(s))")
    for ns_dir in namespace_dirs(app_dir):
        namespace = ns_dir.name
        values_dir = ns_dir / VALUES_DIR_NAME
        if not values_dir.is_dir():
            continue
        ns_defaults = load_yaml(ns_dir / DEFAULTS_FILE_NAME)
        names = sorted(p.name[: -len("-values.yaml")] for p in values_dir.glob("*-values.yaml"))
        print(f"  {namespace}/  (namespace defaults.yaml: {len(ns_defaults)} top-level key(s))")
        for name in names:
            print(f"    - {name}")


def cmd_show(args: argparse.Namespace) -> None:
    app_dir = Path(args.app_dir)
    values_path, minimal_path, _ = microservice_paths(app_dir, args.namespace, args.name)
    if not values_path.exists() and not minimal_path.exists():
        sys.exit(f"No such microservice: {args.namespace}/{args.name} under {app_dir}")
    merged = effective_values(app_dir, args.namespace, args.name)
    print(f"# Effective values for {args.namespace}/{args.name}")
    print("# (global defaults -> namespace defaults -> values -> minimal, merged in that order)")
    print(dump_yaml(merged))


def cmd_new(args: argparse.Namespace) -> None:
    app_dir = Path(args.app_dir)
    namespace, name = args.namespace, args.name
    values_path, minimal_path, release_path = microservice_paths(app_dir, namespace, name)
    if values_path.exists() or minimal_path.exists():
        sys.exit(f"{namespace}/{name} already exists — use `set` to edit it, not `new`.")

    values: dict = {}
    minimal: dict = {}

    if args.workload_type:
        set_path(values, "workload.type", args.workload_type)
    if args.replicas is not None:
        set_path(values, "replicaCount", args.replicas)

    if args.image:
        repo, tag = split_image(args.image)
        set_path(values, "image.repository", repo)
        if tag:
            set_path(minimal, "image.tag", tag)

    for spec in args.port or []:
        port_name, _, container_port = spec.partition(":")
        if not container_port:
            sys.exit(f"--port must be name:containerPort, got: {spec}")
        set_path(values, f"ports.{port_name}.containerPort", int(container_port))

    if args.service_port:
        set_path(values, "service.enabled", True)
        for spec in args.service_port:
            bits = spec.split(":")
            if len(bits) not in (2, 3):
                sys.exit(f"--service-port must be name:port[:targetPort], got: {spec}")
            svc_name, svc_port = bits[0], bits[1]
            target = bits[2] if len(bits) == 3 else svc_name
            set_path(values, f"service.ports.{svc_name}.port", int(svc_port))
            set_path(values, f"service.ports.{svc_name}.targetPort", target)

    if args.route_host:
        set_path(values, "route.enabled", True)
        set_path(values, "route.host", args.route_host)

    resources: dict = {}
    if args.cpu_request or args.mem_request:
        resources.setdefault("requests", {})
        if args.cpu_request:
            resources["requests"]["cpu"] = args.cpu_request
        if args.mem_request:
            resources["requests"]["memory"] = args.mem_request
    if args.cpu_limit or args.mem_limit:
        resources.setdefault("limits", {})
        if args.cpu_limit:
            resources["limits"]["cpu"] = args.cpu_limit
        if args.mem_limit:
            resources["limits"]["memory"] = args.mem_limit
    if resources:
        set_path(values, "resources", resources)

    for spec in args.env or []:
        env_name, sep, env_value = spec.partition("=")
        if not sep:
            sys.exit(f"--env must be NAME=value, got: {spec}")
        set_path(minimal, f"env.{env_name}.value", parse_scalar(env_value))

    for spec in args.set or []:
        dotted_path, sep, raw_value = spec.partition("=")
        if not sep:
            sys.exit(f"--set must be dotted.path=value, got: {spec}")
        value = parse_scalar(raw_value)
        target = minimal if is_minimal_path(dotted_path, value) else values
        set_path(target, dotted_path, value)

    global_defaults, ns_defaults = load_layers(app_dir, namespace)
    layer_base = deep_merge(global_defaults, ns_defaults)
    trimmed = subtract_defaults(values, layer_base)
    omitted_keys = sorted(set(_flatten_keys(values)) - set(_flatten_keys(trimmed)))
    if omitted_keys:
        print("Already covered by defaults.yaml — omitted from the new file:")
        for k in omitted_keys:
            print(f"  - {k}")

    values_path.parent.mkdir(parents=True, exist_ok=True)
    minimal_path.parent.mkdir(parents=True, exist_ok=True)
    release_path.parent.mkdir(parents=True, exist_ok=True)
    header_full = (
        f"# Hand-authored via values_editor.py new — safe to edit further by hand\n"
        f"# or with `values_editor.py set`.\n\n"
    )
    header_min = (
        f"# Hand-authored MINIMAL override for '{name}' — image tag + literal env only.\n\n"
    )
    values_path.write_text(header_full + dump_yaml(trimmed), encoding="utf-8")
    minimal_path.write_text(header_min + dump_yaml(minimal), encoding="utf-8")
    if not release_path.exists():
        release_path.write_text(dump_yaml({"release": name}), encoding="utf-8")

    print(f"\nWrote {values_path}")
    print(f"Wrote {minimal_path}")
    print(f"Wrote {release_path}")
    print(f"\nEffective (merged) result:\n")
    print(dump_yaml(effective_values(app_dir, namespace, name)))


def _flatten_keys(d: dict, prefix: str = "") -> list[str]:
    out = []
    for k, v in d.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict) and v:
            out.extend(_flatten_keys(v, path))
        else:
            out.append(path)
    return out


def cmd_set(args: argparse.Namespace) -> None:
    app_dir = Path(args.app_dir)
    values_path, minimal_path, _ = microservice_paths(app_dir, args.namespace, args.name)
    if not values_path.exists() and not minimal_path.exists():
        sys.exit(f"No such microservice: {args.namespace}/{args.name} under {app_dir}")

    value = parse_scalar(args.value)
    target_path = minimal_path if is_minimal_path(args.key, value) else values_path
    doc = load_yaml(target_path)
    set_path(doc, args.key, value)

    global_defaults, ns_defaults = load_layers(app_dir, args.namespace)
    layer_base = deep_merge(global_defaults, ns_defaults)
    if get_path(layer_base, args.key) == value:
        print(f"Note: {args.key} = {value!r} is already what defaults.yaml supplies — "
              f"you likely don't need to set this at all. Setting it anyway (explicit wins).")

    header = target_path.read_text(encoding="utf-8").split("\n\n", 1)[0] + "\n\n" \
        if target_path.exists() and target_path.read_text(encoding="utf-8").startswith("#") else ""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(header + dump_yaml(doc), encoding="utf-8")
    print(f"Set {args.key} = {value!r} in {target_path}")


def cmd_validate(args: argparse.Namespace) -> None:
    app_dir = Path(args.app_dir)
    if not app_dir.is_dir():
        sys.exit(f"App directory not found: {app_dir}")

    schema = None
    if args.schema:
        import json
        schema = json.loads(Path(args.schema).read_text(encoding="utf-8"))
        try:
            import jsonschema
        except ImportError:
            sys.exit("--schema given but the 'jsonschema' package isn't installed "
                      "(pip install jsonschema)")

    errors: list[str] = []
    rendered = 0
    for ns_dir in namespace_dirs(app_dir):
        namespace = ns_dir.name
        values_dir = ns_dir / VALUES_DIR_NAME
        values_minimal_dir = ns_dir / VALUES_MINIMAL_DIR_NAME
        if not values_dir.is_dir():
            continue
        global_defaults_vf = app_dir / DEFAULTS_FILE_NAME
        ns_defaults_vf = ns_dir / DEFAULTS_FILE_NAME
        for vf in sorted(values_dir.glob("*-values.yaml")):
            name = vf.name[: -len("-values.yaml")]
            merged = effective_values(app_dir, namespace, name)

            if schema is not None:
                import jsonschema
                validator = jsonschema.Draft7Validator(schema)
                for err in validator.iter_errors(merged):
                    errors.append(f"[{namespace}/{name}] schema: {'.'.join(str(p) for p in err.path)}: {err.message}")

            if args.chart:
                value_files = [f for f in (global_defaults_vf, ns_defaults_vf) if f.exists()] + [vf]
                minimal_vf = values_minimal_dir / f"{name}-values-minimal.yaml"
                if minimal_vf.exists():
                    value_files.append(minimal_vf)
                cmd = ["helm", "template", name, args.chart, "--namespace", namespace]
                for f in value_files:
                    cmd += ["-f", str(f)]
                result = subprocess.run(cmd, capture_output=True, text=True)
                rendered += 1
                if result.returncode != 0:
                    errors.append(f"[{namespace}/{name}] helm template failed:\n{result.stderr.strip()}")

    if args.chart:
        print(f"Rendered {rendered} microservice(s) with helm template.")
    if errors:
        print(f"\n{len(errors)} issue(s) found:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("No issues found.")


# ---------------------------------------------------------------------------
# CLI wiring
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List every namespace + microservice under an app-dir")
    p_list.add_argument("--app-dir", required=True)
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="Print the fully-merged effective values for one microservice")
    p_show.add_argument("--app-dir", required=True)
    p_show.add_argument("--namespace", required=True)
    p_show.add_argument("--name", required=True)
    p_show.set_defaults(func=cmd_show)

    p_new = sub.add_parser("new", help="Scaffold a brand-new microservice")
    p_new.add_argument("--app-dir", required=True)
    p_new.add_argument("--namespace", required=True)
    p_new.add_argument("--name", required=True)
    p_new.add_argument("--image", help="repository[:tag]")
    p_new.add_argument("--workload-type", choices=["deployment", "statefulset", "daemonset", "none"])
    p_new.add_argument("--replicas", type=int)
    p_new.add_argument("--port", action="append", help="name:containerPort (repeatable)")
    p_new.add_argument("--service-port", action="append", help="name:port[:targetPort] (repeatable)")
    p_new.add_argument("--route-host")
    p_new.add_argument("--cpu-request")
    p_new.add_argument("--mem-request")
    p_new.add_argument("--cpu-limit")
    p_new.add_argument("--mem-limit")
    p_new.add_argument("--env", action="append", help="NAME=value literal env (repeatable, goes to minimal)")
    p_new.add_argument("--set", action="append", help="dotted.path=value, for anything without a dedicated flag")
    p_new.set_defaults(func=cmd_new)

    p_set = sub.add_parser("set", help="Patch a single key on an existing microservice")
    p_set.add_argument("--app-dir", required=True)
    p_set.add_argument("--namespace", required=True)
    p_set.add_argument("--name", required=True)
    p_set.add_argument("--key", required=True, help="dotted.path, e.g. resources.limits.memory")
    p_set.add_argument("--value", required=True)
    p_set.set_defaults(func=cmd_set)

    p_validate = sub.add_parser("validate", help="Validate merged values against the schema and/or a real chart")
    p_validate.add_argument("--app-dir", required=True)
    p_validate.add_argument("--schema", help="path to values.schema.json")
    p_validate.add_argument("--chart", help="path to the Universal Chart, for a real helm template render")
    p_validate.set_defaults(func=cmd_validate)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
