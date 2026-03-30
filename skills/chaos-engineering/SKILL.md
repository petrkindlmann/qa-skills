---
name: chaos-engineering
description: >-
  Validate system resilience through controlled fault injection. Covers hypothesis-driven
  chaos experiments, failure injection types (network, service, infrastructure, dependency),
  LitmusChaos/Gremlin/toxiproxy tooling, game day planning, and progressive chaos
  adoption. Use when: "chaos engineering," "fault injection," "resilience test,"
  "game day," "failure recovery," "system reliability."
  Related: performance-testing, release-readiness, test-environments.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: knowledge
---

<objective>
Chaos engineering is the discipline of experimenting on a system to build confidence in its ability to withstand turbulent conditions. It is not random destruction -- it is hypothesis-driven, controlled experimentation that reveals weaknesses before they cause outages.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Environment and readiness:**
- Where will chaos experiments run? (Pre-production only, production with approval, never production)
- What is the team's monitoring maturity? Can you detect problems in real time?
- Has the team practiced incident response? Is there a runbook?
- Is there executive buy-in for chaos engineering? (Important for production experiments)

**Architecture:**
- What is the architecture? (Monolith, microservices, serverless, hybrid)
- What are the critical dependencies? (Database, cache, message queue, third-party APIs)
- Are there single points of failure? (Single database, single region, no redundancy)
- What redundancy and failover mechanisms exist?

**Current resilience practices:**
- Do services have health checks? What do they check?
- Are there circuit breakers, retry logic, or timeout configurations?
- What happens when a dependency is unavailable? (Graceful degradation, hard failure, unknown)
- Have you experienced unexpected outages? What failed?

**Team and culture:**
- Is the team comfortable with controlled failure? (Anxiety is normal and should be addressed)
- Who would be the chaos engineering champion? (Needs someone to own the practice)
- What is the appetite for starting? (Start small or dive in)

---

## Core Principles

### 1. Hypothesis-driven: define expected behavior before injecting

Every chaos experiment starts with a hypothesis: "We believe that if [failure X occurs], the system will [expected behavior Y]." Without a hypothesis, you are just breaking things.

Example hypothesis: "We believe that if the primary database becomes unavailable, the application will serve cached data for read requests and queue write requests for up to 5 minutes without user-visible errors."

### 2. Start small: one service, controlled blast radius

The first chaos experiment should not be "shut down production." It should be "add 200ms latency to one non-critical service in staging." Increase scope gradually as confidence and tooling mature.

### 3. Monitoring is a prerequisite

If you cannot detect problems in real time, you cannot safely inject failures. Chaos experiments without monitoring are just outages with extra steps. Verify dashboards, alerts, and on-call processes before running any experiment.

### 4. Game days build muscle memory

Running chaos experiments in automated pipelines is valuable, but game days -- scheduled sessions where the team runs experiments together and practices response -- build the human skills that matter during real incidents.

---

## Chaos Experiment Workflow

Every chaos experiment follows this five-step process.

### Step 1: Define steady state hypothesis

Identify the metrics that define "normal" and predict what should happen during the experiment.

```
Experiment: Database failover
Steady state:
  - Error rate: < 0.1%
  - P95 latency: < 300ms
  - Successful orders per minute: > 50

Hypothesis: When the primary database fails over to the replica,
  - Error rate will spike to < 2% for < 30 seconds
  - P95 latency will increase to < 1s for < 60 seconds
  - No orders will be permanently lost
  - The application will recover without manual intervention
```

### Step 2: Introduce the variable

Inject the failure in a controlled way with a clear scope and duration.

```
Injection:
  Target: primary database (PostgreSQL)
  Method: block TCP port 5432 on the primary instance
  Scope: single database instance
  Duration: 60 seconds
  Blast radius: staging environment only (first run)

  Abort conditions:
    - Error rate > 10% for > 2 minutes
    - Any data corruption detected
    - Manual abort by experiment owner
```

### Step 3: Observe

During the experiment, monitor all relevant metrics in real time. Assign observers to specific dashboards.

```
Observation assignments:
  - Engineer A: application error rate and latency dashboard
  - Engineer B: database metrics (connections, replication lag, failover status)
  - Engineer C: application logs (search for database connection errors)
  - Engineer D: business metrics (order count, payment processing)
```

### Step 4: Analyze recovery and data integrity

After the experiment, analyze what happened versus what was expected.

```
Analysis checklist:
  - Did the system behave as hypothesized? (Y/N, with details)
  - How long was the impact? (Expected vs. actual duration)
  - Were any errors visible to users?
  - Was any data lost or corrupted?
  - Did monitoring and alerting detect the problem correctly?
  - How long before alerts fired?
  - What was the recovery time?
```

### Step 5: Fix and iterate

Document findings, fix resilience gaps, and schedule a re-run to verify the fix.

```
Findings document:
  Experiment: Database failover (2026-03-20)
  Hypothesis: Confirmed / Partially confirmed / Disproved

  Findings:
    - Connection pool did not detect stale connections for 45 seconds (expected: <10s)
    - Retry logic worked correctly for read operations
    - Write operations returned 500 errors for 38 seconds (expected: queued)

  Action items:
    - [ ] Configure connection pool health checks (idle connection validation)
    - [ ] Implement write queue with 5-minute buffer for database unavailability
    - [ ] Re-run experiment after fixes deployed (target: 2026-04-03)
```

---

## Failure Injection Types

### Network failures

| Failure | Tool | Use Case |
|---------|------|----------|
| Latency injection | tc, toxiproxy, Gremlin | Simulate slow network, distant regions |
| Packet loss | tc netem, Chaos Mesh | Simulate unreliable network |
| DNS failure | iptables, CoreDNS manipulation | Simulate DNS outage |
| Network partition | iptables, Chaos Mesh | Simulate split-brain scenarios |
| Bandwidth restriction | tc, toxiproxy | Simulate congested network |

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

### Service failures

| Failure | Method | Use Case |
|---------|--------|----------|
| Service crash | Kill process, pod delete | Simulate unexpected crash |
| Service slowdown | CPU stress, thread pool exhaustion | Simulate overloaded service |
| Error injection | Return 500/503, throw exceptions | Simulate application errors |
| Memory pressure | stress-ng, Chaos Mesh | Simulate memory leaks |

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

### Infrastructure failures

| Failure | Method | Use Case |
|---------|--------|----------|
| Disk full | fallocate, dd | Simulate disk exhaustion |
| CPU exhaustion | stress-ng | Simulate CPU saturation |
| Memory exhaustion | stress-ng | Simulate OOM conditions |
| Clock skew | chrony manipulation, timedatectl | Simulate time drift |

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

### Dependency failures

| Failure | Method | Use Case |
|---------|--------|----------|
| API down | toxiproxy, mock server | Simulate third-party outage |
| Database unavailable | block port, kill process | Simulate database outage |
| Cache unavailable | block Redis port | Simulate cache miss storm |
| Message queue full | fill queue, block consumers | Simulate backpressure |

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

---

## Tools

| Tool | Type | Best For |
|------|------|----------|
| LitmusChaos | Kubernetes-native, open source | K8s environments, CI/CD integration |
| Chaos Mesh | Kubernetes-native, CNCF | K8s with fine-grained control |
| Gremlin | Managed platform | Teams wanting guided experiments |
| Chaos Monkey (Netflix) | Service-level, open source | Random instance termination |
| toxiproxy | Network proxy, open source | Network fault injection in tests |
| tc (traffic control) | Linux kernel | Network latency and packet loss |
| stress-ng | Linux utility | CPU, memory, disk stress testing |
| k6 | Load testing tool | Combined load + chaos scenarios |

### Choosing a tool

```
Decision tree:
  Running on Kubernetes?
    → Yes: LitmusChaos or Chaos Mesh (native integration)
    → No: Gremlin (managed) or tc + stress-ng (manual)

  Need network fault injection in integration tests?
    → toxiproxy (lightweight, programmatic API)

  Need to combine load testing with chaos?
    → k6 with xk6-disruptor extension

  Need managed platform with UI and compliance?
    → Gremlin (commercial)
```

---

## Game Day Planning

A game day is a scheduled session where the team runs chaos experiments together, practices incident response, and builds confidence in the system's resilience.

### Preparation checklist

```
2 weeks before:
  - [ ] Define 2-3 experiments to run (don't overload the schedule)
  - [ ] Write hypotheses for each experiment
  - [ ] Get approval from engineering leadership and affected teams
  - [ ] Notify support team and stakeholders
  - [ ] Verify monitoring and alerting are working
  - [ ] Identify rollback procedures for each experiment
  - [ ] Schedule 3-4 hour block (experiments + analysis + retro)

1 day before:
  - [ ] Confirm all participants and their roles
  - [ ] Test that fault injection tools work in the target environment
  - [ ] Verify rollback procedures work (dry run)
  - [ ] Prepare dashboards and observation assignments
  - [ ] Brief the on-call team
  - [ ] Confirm abort criteria for each experiment
```

### Communication and roles

Communicate before (schedule, scope, abort authority), during (live updates every 15 minutes in a dedicated channel), and after (summary within 24 hours with findings and action items).

Assign roles per experiment: **experiment owner** (runs it, makes abort decisions), **observers** (application metrics, infrastructure metrics, logs, user experience), and a **scribe** (records timeline and decisions).

### Post-game retrospective

For each experiment: was the hypothesis confirmed? What surprised us? What action items do we have? For the process: did monitoring detect problems? Did alerts fire? Were we comfortable with the blast radius? Close with action items (with owners and due dates) and schedule the next game day.

---

## Starting Small: First Three Experiments

For teams new to chaos engineering, start with these three experiments in a pre-production environment.

### Experiment 1: Slow database

**Why first:** Database latency is the most common cause of user-facing slowness, and the experiment is easy to set up and reverse.

```
Hypothesis: When database latency increases by 500ms, the application
will remain functional with response times under 3 seconds.

Injection: Add 500ms latency to the database connection using toxiproxy.
Duration: 5 minutes.
Environment: staging.

What to observe:
  - Application response times (should increase by ~500ms, not 10x)
  - Connection pool behavior (should not exhaust connections)
  - Timeout handling (requests should not hang indefinitely)
  - Circuit breaker activation (if implemented)
  - Cache effectiveness (cached reads should be unaffected)
```

### Experiment 2: Third-party API returns 500s

**Why second:** Third-party dependencies fail regularly, and the application's handling of those failures is often untested.

```
Hypothesis: When the payment provider returns 500 errors, the
application will show a user-friendly error message and allow
retry without duplicate charges.

Injection: Configure mock/proxy to return 500 for payment API calls.
Duration: 10 minutes.
Environment: staging.

What to observe:
  - Error message quality (user-friendly, not stack traces)
  - Retry behavior (does the application retry? How many times?)
  - Idempotency (retries don't create duplicate transactions)
  - Fallback (is there an alternative payment path?)
  - Monitoring (does the payment failure show up in alerts?)
```

### Experiment 3: Cache unavailable

**Why third:** Cache failures cause "thundering herd" problems where all traffic suddenly hits the database, often causing cascading failures.

```
Hypothesis: When Redis becomes unavailable, the application will fall
back to direct database queries with degraded but functional performance.

Injection: Block Redis port using toxiproxy or iptables.
Duration: 5 minutes.
Environment: staging.

What to observe:
  - Database query volume (should increase but not overwhelm)
  - Response times (should increase but remain under 5 seconds)
  - Error rate (cache miss should not cause errors)
  - Connection pool (database connections should not exhaust)
  - Recovery (when cache returns, does the application resume normal behavior?)
```

---

## Anti-Patterns

### Chaos without monitoring

Injecting failures without the ability to observe their impact is not chaos engineering -- it is sabotage. You will not know if the experiment revealed a problem until a user complains.

**Fix:** Before any chaos experiment, verify that you can see error rates, latency, throughput, and dependency health in real time. If you cannot, invest in monitoring first.

### Starting too big

The first chaos experiment should not be "kill the production database." Starting with high-impact experiments before the team has practiced with low-impact ones creates anxiety and potential real outages.

**Fix:** Start with staging. Start with non-critical services. Start with reversible injections (latency, not data corruption). Build confidence gradually. Graduate to production only after multiple successful staging experiments.

### No rollback plan

"The experiment is only 60 seconds, we don't need a rollback plan." Then the fault injection tool crashes and the failure persists indefinitely.

**Fix:** Every experiment must have a documented rollback procedure that can be executed in under 30 seconds. Test the rollback before running the experiment. Have a second person ready to abort if the experiment owner is unable to.

### Chaos in production without approval

Running chaos experiments in production without explicit approval from engineering leadership and affected teams destroys trust and careers.

**Fix:** Production chaos requires explicit, documented approval. Start with staging. Communicate broadly before production experiments. Get buy-in from all affected teams. Make the scope, duration, and abort criteria clear to everyone.

### Running chaos experiments during incidents

Adding controlled failures to a system that is already experiencing problems makes diagnosis harder and extends the outage.

**Fix:** Cancel or postpone chaos experiments if the system is not in steady state. Check for active incidents before starting. If an unrelated incident starts during an experiment, abort the experiment immediately.

### No follow-through on findings

The experiment revealed that the circuit breaker does not work correctly. The team says "interesting" and moves on. The finding is never fixed. The next real outage triggers the same failure.

**Fix:** Every chaos experiment finding gets a ticket with an owner and a due date. Re-run the experiment after the fix to verify. Track the backlog of chaos findings alongside production incident action items.

---

## Done When

- Every experiment has a written hypothesis stating the expected system behavior before any fault is injected
- Blast radius is explicitly bounded (target scope, duration, and abort conditions defined) and experiments are not run directly in production until staging results are stable
- Steady-state baseline metrics are measured immediately before each injection so results have a valid comparison point
- Experiment results are documented with actual vs. expected behavior, recovery time, and whether data integrity was maintained
- Each weakness found has a remediation action item with an assigned owner, due date, and a scheduled re-run to verify the fix

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `performance-testing` | Load testing complements chaos engineering; combine for realistic failure scenarios |
| `release-readiness` | Chaos experiment results feed into release confidence assessments |
| `test-environments` | Pre-production environments are the safe starting point for chaos experiments |
| `testing-in-production` | Production chaos is the advanced stage of testing in production |
| `observability-driven-testing` | Observability is a prerequisite for chaos engineering |
| `qa-metrics` | Chaos experiment results (recovery time, error impact) are quality metrics |
