{{/*
=============================================================================
SHARED POD SPEC — used by Deployment, StatefulSet, DaemonSet
=============================================================================
Call: {{- include "universal-chart.podSpec" . | nindent 6 }}
*/}}
{{- define "universal-chart.podSpec" -}}
serviceAccountName: {{ include "universal-chart.serviceAccountName" . }}
automountServiceAccountToken: {{ .Values.serviceAccount.automountServiceAccountToken }}

{{- /* ── Image pull secrets ─────────────────────────── */}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}

{{- /* ── Pod security context ──────────────────────── */}}
{{- with .Values.podSecurityContext }}
securityContext:
  {{- toYaml . | nindent 2 }}
{{- end }}

{{- /* ── Termination & DNS ────────────────────────── */}}
terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
{{- if .Values.hostNetwork }}
hostNetwork: true
{{- end }}
{{- if .Values.hostIPC }}
hostIPC: true
{{- end }}
{{- if .Values.hostPID }}
hostPID: true
{{- end }}
{{- if .Values.shareProcessNamespace }}
shareProcessNamespace: true
{{- end }}
{{- with .Values.dnsPolicy }}
dnsPolicy: {{ . }}
{{- end }}
{{- with .Values.dnsConfig }}
dnsConfig:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.priorityClassName }}
priorityClassName: {{ . }}
{{- end }}
{{- with .Values.runtimeClassName }}
runtimeClassName: {{ . }}
{{- end }}
{{- with .Values.schedulerName }}
schedulerName: {{ . }}
{{- end }}
{{- with .Values.restartPolicy }}
restartPolicy: {{ . }}
{{- end }}
{{- with .Values.readinessGates }}
readinessGates:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.hostAliases }}
hostAliases:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.overhead }}
overhead:
  {{- toYaml . | nindent 2 }}
{{- end }}

{{- /* ── Init containers (map-based) ────────────────── */}}
{{- with .Values.initContainers }}
initContainers:
  {{- range $name, $spec := . }}
  - name: {{ $name }}
    {{- toYaml $spec | nindent 4 }}
  {{- end }}
{{- end }}

{{- /* ── Main container ───────────────────────────── */}}
containers:
  {{- include "universal-chart.mainContainer" . | nindent 2 }}
  {{- /* ── Sidecar containers (map-based) ──────────── */}}
  {{- range $name, $spec := .Values.sidecars }}
  - name: {{ $name }}
    {{- toYaml $spec | nindent 4 }}
  {{- end }}

{{- /* ── Volumes (map-based) ─────────────────────── */}}
{{- with .Values.volumes }}
volumes:
  {{- include "universal-chart.mapToList" . | nindent 2 }}
{{- end }}

{{- /* ── Scheduling ───────────────────────────────── */}}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}


{{/*
=============================================================================
MAIN CONTAINER — all possible container spec fields
=============================================================================
*/}}
{{- define "universal-chart.mainContainer" -}}
- name: {{ include "universal-chart.name" . }}
  image: {{ include "universal-chart.image" . }}
  imagePullPolicy: {{ .Values.image.pullPolicy }}

  {{- with .Values.securityContext }}
  securityContext:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.command }}
  command:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.args }}
  args:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.workingDir }}
  workingDir: {{ . }}
  {{- end }}

  {{- with .Values.ports }}
  ports:
    {{- include "universal-chart.mapToList" . | nindent 4 }}
  {{- end }}

  {{- with .Values.env }}
  env:
    {{- include "universal-chart.mapToList" . | nindent 4 }}
  {{- end }}

  {{- with .Values.envFrom }}
  envFrom:
    {{- range $name, $spec := . }}
    - {{ $spec.type | default "configMapRef" }}:
        name: {{ $name }}
      {{- if hasKey $spec "optional" }}
      optional: {{ $spec.optional }}
      {{- end }}
    {{- end }}
  {{- end }}

  {{- with .Values.resources }}
  resources:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.livenessProbe }}
  livenessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.readinessProbe }}
  readinessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.startupProbe }}
  startupProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.containerRestartRules }}
  containerRestartRules:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.lifecycle }}
  lifecycle:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- with .Values.volumeMounts }}
  volumeMounts:
    {{- include "universal-chart.mapToList" . | nindent 4 }}
  {{- end }}

  {{- with .Values.volumeDevices }}
  volumeDevices:
    {{- toYaml . | nindent 4 }}
  {{- end }}

  {{- if .Values.stdin }}
  stdin: true
  {{- end }}
  {{- if .Values.stdinOnce }}
  stdinOnce: true
  {{- end }}
  {{- if .Values.tty }}
  tty: true
  {{- end }}

  {{- with .Values.terminationMessagePath }}
  terminationMessagePath: {{ . }}
  {{- end }}
  {{- with .Values.terminationMessagePolicy }}
  terminationMessagePolicy: {{ . }}
  {{- end }}
{{- end }}


{{/*
=============================================================================
SHARED JOB POD SPEC — for CronJob / Job
=============================================================================
Call: {{- include "universal-chart.jobPodSpec" (dict "Values" $.Values "Chart" $.Chart "Release" $.Release "job" $job) }}
*/}}
{{- define "universal-chart.jobPodSpec" -}}
restartPolicy: {{ .job.restartPolicy | default "OnFailure" }}
serviceAccountName: {{ include "universal-chart.serviceAccountName" . }}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.podSecurityContext }}
securityContext:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .job.initContainers }}
initContainers:
  {{- range $name, $spec := . }}
  - name: {{ $name }}
    {{- toYaml $spec | nindent 4 }}
  {{- end }}
{{- end }}
containers:
  - name: {{ .job.name }}
    image: {{ if .job.image }}{{ printf "%s:%s" .job.image.repository (.job.image.tag | default .Chart.AppVersion) }}{{ else }}{{ include "universal-chart.image" . }}{{ end }}
    imagePullPolicy: {{ .Values.image.pullPolicy }}
    {{- with .job.command }}
    command:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    {{- with .job.args }}
    args:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    {{- with .job.env }}
    env:
      {{- include "universal-chart.mapToList" . | nindent 6 }}
    {{- end }}
    {{- with .job.envFrom }}
    envFrom:
      {{- range $name, $spec := . }}
      - {{ $spec.type | default "configMapRef" }}:
          name: {{ $name }}
      {{- end }}
    {{- end }}
    {{- with .job.resources }}
    resources:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    {{- with .job.volumeMounts }}
    volumeMounts:
      {{- include "universal-chart.mapToList" . | nindent 6 }}
    {{- end }}
  {{- range $name, $spec := .job.sidecars }}
  - name: {{ $name }}
    {{- toYaml $spec | nindent 4 }}
  {{- end }}
{{- with .job.volumes }}
volumes:
  {{- include "universal-chart.mapToList" . | nindent 2 }}
{{- end }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
