// Copies the AWS Architecture Icons this project uses, unmodified, from the official
// asset package (https://aws.amazon.com/architecture/icons/) into public/icons/aws.
// Usage: node scripts/vendor-aws-icons.mjs <path-to-extracted-Asset-Package>
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/vendor-aws-icons.mjs <extracted asset package dir>");
  process.exit(1);
}

const svc = (dir, name) => path.join(fs.readdirSync(root).find((d) => d.startsWith("Architecture-Service-Icons")), dir, "64", `Arch_${name}_64.svg`);
const ICONS = {
  aws: path.join(fs.readdirSync(root).find((d) => d.startsWith("Architecture-Group-Icons")), "AWS-Cloud-logo_32_Dark.svg"),
  lambda: svc("Arch_Compute", "AWS-Lambda"),
  ec2: svc("Arch_Compute", "Amazon-EC2"),
  ecs: svc("Arch_Containers", "Amazon-Elastic-Container-Service"),
  eks: svc("Arch_Containers", "Amazon-Elastic-Kubernetes-Service"),
  ecr: svc("Arch_Containers", "Amazon-Elastic-Container-Registry"),
  s3: svc("Arch_Storage", "Amazon-Simple-Storage-Service"),
  rds: svc("Arch_Database", "Amazon-RDS"),
  dynamodb: svc("Arch_Database", "Amazon-DynamoDB"),
  elasticache: svc("Arch_Database", "Amazon-ElastiCache"),
  sqs: svc("Arch_App-Integration", "Amazon-Simple-Queue-Service"),
  cloudwatch: svc("Arch_Management-Governance", "Amazon-CloudWatch"),
  route53: svc("Arch_Networking-Content-Delivery", "Amazon-Route-53"),
  apigateway: svc("Arch_Networking-Content-Delivery", "Amazon-API-Gateway"),
  cloudfront: svc("Arch_Networking-Content-Delivery", "Amazon-CloudFront"),
  vpc: svc("Arch_Networking-Content-Delivery", "Amazon-Virtual-Private-Cloud"),
  elb: svc("Arch_Networking-Content-Delivery", "Elastic-Load-Balancing"),
  cognito: svc("Arch_Security-Identity-Compliance", "Amazon-Cognito"),
  iam: svc("Arch_Security-Identity-Compliance", "AWS-Identity-and-Access-Management"),
  waf: svc("Arch_Security-Identity-Compliance", "AWS-WAF"),
  secretsmanager: svc("Arch_Security-Identity-Compliance", "AWS-Secrets-Manager"),
  bedrock: svc("Arch_Artificial-Intelligence", "Amazon-Bedrock"),
  xray: svc("Arch_Developer-Tools", "AWS-X-Ray"),
  budgets: svc("Arch_Cloud-Financial-Management", "AWS-Budgets"),
};

const out = "public/icons/aws";
fs.mkdirSync(out, { recursive: true });
for (const [id, rel] of Object.entries(ICONS)) {
  fs.copyFileSync(path.join(root, rel), path.join(out, `${id}.svg`));
}
fs.writeFileSync(
  path.join(out, "NOTICE.md"),
  `# AWS Architecture Icons

Unmodified copies from the official AWS Architecture Icons asset package
(release 07/31/2025), https://aws.amazon.com/architecture/icons/.

AWS permits customers and partners to use these icons to create architecture
diagrams. They are used here only to identify AWS services in the knowledge map.
Amazon Web Services, AWS and the service names are trademarks of Amazon.com, Inc.
or its affiliates.

Regenerate with: node scripts/vendor-aws-icons.mjs <extracted asset package>
`,
);
console.log(`aws icons: ${Object.keys(ICONS).length} copied to ${out}`);
