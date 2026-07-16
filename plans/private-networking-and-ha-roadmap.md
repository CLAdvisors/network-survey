# Private networking and API high-availability roadmap

## Current API/network shape

The current production and staging API stacks use a cost-conscious single-instance pattern:

```text
Internet
  -> public ALB
  -> single EC2 API instance in a public subnet
  -> RDS
```

Current safeguards:

- The ALB is public and terminates HTTPS.
- The API EC2 instance currently has a public IP, but its security group only allows API port `3000` from the ALB security group.
- SSH ingress is disabled unless `ssh_allowed_cidrs` is explicitly configured; normal access should use SSM Session Manager.
- RDS is not publicly exposed and is protected by security groups.
- Runtime API secrets are read from SSM Parameter Store SecureString.

This is acceptable for the current inactive/demo production state, but it is not the final hardened production topology.

## Definitions

### Private networking

Private networking reduces exposure by removing direct public reachability from API compute:

```text
Internet
  -> public ALB in public subnets
  -> API instances in private subnets, no public IPs
  -> private RDS
```

Private API instances still need outbound access for AWS APIs, package/image pulls, deploy artifacts, SSM, logs, and selected external APIs. That outbound path can be provided by NAT Gateway, VPC endpoints, prebuilt AMIs/images, or some combination.

### High availability (HA)

HA means the API can survive instance or Availability Zone failure with little/no manual intervention:

```text
public ALB across AZ A/B
  -> API target in private subnet AZ A
  -> API target in private subnet AZ B
  -> RDS
```

For EC2, HA generally means an Auto Scaling Group (ASG) with at least two desired instances across multiple AZs and ALB health checks.

## Cost considerations

### Current public single EC2

Lowest API compute/network cost, but least resilient and not fully private.

### Private EC2 plus NAT Gateway

Simple and standard, but NAT Gateway can be a meaningful monthly fixed cost for a small app and also has per-GB processing charges.

### Private EC2 plus VPC endpoints

Can avoid NAT for AWS service traffic, especially S3 and SSM, but interface endpoints have hourly per-AZ costs. Several endpoints can approach or exceed NAT cost. This works best if the instance does not need general internet egress during boot/deploy.

Useful endpoints to evaluate:

- S3 gateway endpoint
- SSM interface endpoint
- EC2 messages interface endpoint
- SSM messages interface endpoint
- CloudWatch Logs interface endpoint
- KMS interface endpoint, if needed for encrypted SSM/log flows

### ASG + EC2

Usually the cheapest path to self-healing and HA for a small always-on API. Desired capacity `1` gives self-healing at almost the current compute cost. Desired capacity `2` across AZs roughly doubles API EC2 compute cost but provides real instance/AZ redundancy behind the ALB.

### ECS/Fargate

Operationally cleaner for deployments and replacement, but generally more expensive for a tiny always-on service than small EC2 instances. Revisit when containerization/operational simplicity outweighs the cost difference.

## Recommended path

### Phase 1: ASG-managed EC2, desired capacity 1

Goal: self-healing without a large cost increase.

- Replace standalone `aws_instance` with a launch template + ASG.
- Keep ALB target group and deploy artifact model.
- Desired capacity: `1`.
- Minimum capacity: `1`.
- Maximum capacity: `1` or `2` initially.
- Ensure instance bootstrap can reliably install dependencies and deploy the latest artifact.
- Add ALB target health alarms before or during this step.

This phase still may use public subnets/public IPs to minimize network change risk.

### Phase 2: Private subnets for API instances

Goal: remove direct public reachability from API compute.

- Move ASG subnets to private subnets.
- Set instances to no public IP.
- Keep ALB in public subnets.
- Add the minimum required outbound path:
  - Prefer S3 gateway endpoint for artifact/config access.
  - Add SSM/EC2 messages/SSM messages endpoints for Session Manager.
  - Add CloudWatch Logs endpoint if shipping logs.
  - Use NAT Gateway only if general internet egress is required.
- Consider prebuilt AMIs or images so boot does not depend on arbitrary internet apt/npm access.

### Phase 3: ASG desired capacity 2 across AZs

Goal: production HA.

- Desired capacity: `2`.
- Place instances across at least two AZs.
- ALB target group should require healthy targets before deploy promotion.
- Deploys should roll across instances or use a blue/green/canary strategy.
- Confirm DB connection limits and migration behavior are safe with multiple API instances.

### Phase 4: Optional ECS/Fargate revisit

Consider ECS/Fargate later if:

- containerized deployments become preferable,
- zero/low-touch instance maintenance is worth the extra cost,
- blue/green deployments become a priority,
- multiple services need consistent orchestration.

## Current priority

For the current app and cost profile, prefer **ASG + EC2** over ECS/Fargate as the next backend architecture step. The likely target is:

```text
Public ALB
  -> ASG-managed EC2 instances across two AZs
  -> RDS
```

Start with desired capacity `1` for self-healing, then move private, then increase to desired capacity `2` when production uptime requirements justify the roughly doubled API compute cost.
