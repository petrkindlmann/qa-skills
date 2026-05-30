# Failure Injection — Runnable Code

Commands, configs, and test code for injecting each failure class. The decision tables (which failure, which tool, which use case) live in `SKILL.md`; this file holds the implementations.

## Network failures

```bash
# Add 200ms latency to all traffic to port 5432 (PostgreSQL)
tc qdisc add dev eth0 root netem delay 200ms 50ms distribution normal

# Add 5% packet loss
tc qdisc add dev eth0 root netem loss 5%

# Remove the injected fault
tc qdisc del dev eth0 root
```

```yaml
# toxiproxy configuration for database latency
- name: postgres-latency
  listen: 0.0.0.0:15432
  upstream: postgres:5432
  toxics:
    - name: latency
      type: latency
      attributes:
        latency: 200
        jitter: 50
```

## Service failures

```bash
# Kill a Kubernetes pod
kubectl delete pod order-service-abc123 --grace-period=0

# Stress CPU on a specific container (via Chaos Mesh)
# chaos-mesh-cpu-stress.yaml
```

```yaml
# LitmusChaos: pod kill experiment
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: order-service-chaos
spec:
  appinfo:
    appns: production
    applabel: app=order-service
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: '60'
            - name: CHAOS_INTERVAL
              value: '30'
            - name: FORCE
              value: 'false'
```

## Infrastructure failures

```bash
# Fill disk to trigger disk-full handling
fallocate -l 10G /tmp/fill-disk.dat

# Stress 4 CPU cores for 60 seconds
stress-ng --cpu 4 --timeout 60s

# Consume 2GB of memory
stress-ng --vm 1 --vm-bytes 2G --timeout 60s

# Cleanup
rm /tmp/fill-disk.dat
```

## Dependency failures

```typescript
// Toxiproxy programmatic control for integration tests
import Toxiproxy from 'toxiproxy-node-client';

const toxiproxy = new Toxiproxy('http://localhost:8474');

test('application handles Redis unavailability gracefully', async () => {
  const proxy = await toxiproxy.get('redis');

  // Disable Redis
  await proxy.disable();

  try {
    const response = await fetch('http://localhost:3000/api/products');
    // Should still work, but slower (cache miss, hits database)
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.products.length).toBeGreaterThan(0);

    // Verify degraded performance is within acceptable range
    const latency = parseInt(response.headers.get('x-response-time') ?? '0');
    expect(latency).toBeLessThan(5000); // 5 seconds max without cache
  } finally {
    // Always re-enable
    await proxy.enable();
  }
});
```
