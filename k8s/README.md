# Kubernetes Deployment Guide

## Prerequisites

- Kubernetes cluster (v1.24+)
- kubectl configured
- Docker registry access
- Helm (optional, for cert-manager)

## Deployment Steps

### 1. Create Namespace and Secrets

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Update secrets.yaml with your actual credentials
kubectl apply -f secrets.yaml

# Apply ConfigMap
kubectl apply -f configmap.yaml
```

### 2. Deploy Storage Layer

```bash
# Deploy Zookeeper
kubectl apply -f zookeeper-deployment.yaml

# Wait for Zookeeper to be ready
kubectl wait --for=condition=ready pod -l app=zookeeper -n sentiment-analysis --timeout=300s

# Deploy Kafka
kubectl apply -f kafka-deployment.yaml

# Deploy MariaDB
kubectl apply -f mariadb-deployment.yaml

# Deploy Memcached
kubectl apply -f memcached-deployment.yaml
```

### 3. Deploy Compute Layer

```bash
# Deploy Spark Master
kubectl apply -f spark-deployment.yaml

# Wait for Spark Master to be ready
kubectl wait --for=condition=ready pod -l app=spark-master -n sentiment-analysis --timeout=300s
```

### 4. Deploy Application Layer

```bash
# Build and push Docker images
docker build -t your-registry/sentiment-backend:latest -f backend/Dockerfile ./backend
docker build -t your-registry/sentiment-frontend:latest -f Dockerfile.frontend .

docker push your-registry/sentiment-backend:latest
docker push your-registry/sentiment-frontend:latest

# Update image references in deployment files
# Then deploy
kubectl apply -f backend-deployment.yaml
kubectl apply -f frontend-deployment.yaml
```

### 5. Configure Networking

```bash
# Apply network policies
kubectl apply -f network-policy.yaml

# Deploy Ingress (update domain in ingress.yaml first)
kubectl apply -f ingress.yaml
```

## Monitoring

### Check Pod Status

```bash
kubectl get pods -n sentiment-analysis
```

### View Logs

```bash
# Backend logs
kubectl logs -f deployment/backend -n sentiment-analysis

# Kafka logs
kubectl logs -f statefulset/kafka -n sentiment-analysis

# Spark Master logs
kubectl logs -f deployment/spark-master -n sentiment-analysis
```

### Check HPA Status

```bash
kubectl get hpa -n sentiment-analysis
```

## Scaling

### Manual Scaling

```bash
# Scale backend
kubectl scale deployment backend --replicas=5 -n sentiment-analysis

# Scale Spark workers
kubectl scale deployment spark-worker --replicas=10 -n sentiment-analysis
```

### Auto-scaling

HPA is configured for:
- Backend (3-20 replicas)
- Frontend (3-10 replicas)
- Spark Workers (3-10 replicas)
- Memcached (2-5 replicas)

## Rolling Updates

```bash
# Update backend image
kubectl set image deployment/backend backend=your-registry/sentiment-backend:v2 -n sentiment-analysis

# Check rollout status
kubectl rollout status deployment/backend -n sentiment-analysis

# Rollback if needed
kubectl rollout undo deployment/backend -n sentiment-analysis
```

## Troubleshooting

### Pod Not Starting

```bash
kubectl describe pod <pod-name> -n sentiment-analysis
kubectl logs <pod-name> -n sentiment-analysis
```

### Database Connection Issues

```bash
# Check MariaDB service
kubectl get svc mariadb-service -n sentiment-analysis

# Test connection from backend pod
kubectl exec -it deployment/backend -n sentiment-analysis -- nc -zv mariadb-service 3306
```

### Kafka Issues

```bash
# Check Kafka topics
kubectl exec -it kafka-0 -n sentiment-analysis -- kafka-topics --bootstrap-server localhost:9092 --list

# Check consumer groups
kubectl exec -it kafka-0 -n sentiment-analysis -- kafka-consumer-groups --bootstrap-server localhost:9092 --list
```

## Cleanup

```bash
# Delete all resources
kubectl delete namespace sentiment-analysis

# Or delete individual components
kubectl delete -f frontend-deployment.yaml
kubectl delete -f backend-deployment.yaml
kubectl delete -f spark-deployment.yaml
kubectl delete -f kafka-deployment.yaml
kubectl delete -f mariadb-deployment.yaml
kubectl delete -f memcached-deployment.yaml
kubectl delete -f zookeeper-deployment.yaml
```

## Production Considerations

1. **Persistent Volume**: Use appropriate StorageClass for your cloud provider
2. **Backup**: Set up regular backups for MariaDB
3. **Monitoring**: Install Prometheus and Grafana for metrics
4. **Logging**: Use ELK or Loki stack for centralized logging
5. **Security**: Enable RBAC, Pod Security Policies, and Network Policies
6. **SSL/TLS**: Configure cert-manager for automatic SSL certificates
7. **Resource Limits**: Adjust based on actual workload
8. **High Availability**: Use PodDisruptionBudgets for critical services
