{{- define "agentdock.storageClass" -}}
{{- if .Values.storage.className }}
storageClassName: {{ .Values.storage.className | quote }}
{{- end }}
{{- end }}

{{- define "agentdock.nodeProbes" -}}
readinessProbe:
  httpGet:
    path: /healthz
    port: http
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 6
livenessProbe:
  httpGet:
    path: /healthz
    port: http
  initialDelaySeconds: 20
  periodSeconds: 20
  timeoutSeconds: 3
  failureThreshold: 5
{{- end }}

{{- define "agentdock.ingressFromController" -}}
- from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: {{ .Values.ingress.namespace | quote }}
      podSelector:
        matchLabels:
          {{- toYaml .Values.ingress.podLabels | nindent 10 }}
{{- end }}

{{- define "agentdock.ingressFromGateway" -}}
- from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: {{ .Values.namespaces.platform | quote }}
      podSelector:
        matchLabels:
          app.kubernetes.io/name: gateway
{{- end }}
