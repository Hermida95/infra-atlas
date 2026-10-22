# github-oidc

One pair of IAM roles per environment, assumable by GitHub Actions through OIDC and by nothing
else. This is the module behind the `oidc` card of the atlas and behind decision 9's "no
long-lived AWS keys".

| Role | Assumable from | Can |
| --- | --- | --- |
| `<project>-<env>-gha-plan` | any pull request, and `main` | read. Nothing else, and a `Deny` makes writing the state impossible |
| `<project>-<env>-gha-apply` | only the GitHub environment `<env>`, only from `refs/heads/main` | create, change and destroy resources named `<project>-<env>-*` |

## How the restriction actually works

A GitHub job token carries a `sub` claim, and that claim is the whole security boundary:

```
repo:Hermida95/infra-atlas:pull_request               a PR     -> plan role
repo:Hermida95/infra-atlas:ref:refs/heads/main        a push   -> plan role
repo:Hermida95/infra-atlas:environment:prod           a job with environment: prod -> apply role
```

The third form is the important one. Once a job declares `environment:`, its subject names the
environment **and stops naming the branch** — so the apply role checks a second claim, `ref`,
for the branch. And because a job *without* `environment:` produces a different subject
entirely, a workflow cannot skip the environment's required reviewer: STS refuses the
`AssumeRoleWithWebIdentity` call. The manual approval is enforced by IAM, not by convention.

`sub` is matched with `StringLike` on the plan role (a subject may legitimately end in `*`) and
with `StringEquals` on the apply role (exactly one environment, no wildcard possible).

## Why the apply role cannot become an administrator

The classic escalation for a deploy role is: create a role, give it `AdministratorAccess`, pass
it to a Lambda, run code as it. Three things block it here:

- every IAM action is scoped to `arn:aws:iam::<account>:role/<project>-<env>-*`;
- there is **no `iam:AttachRolePolicy`** at all, so no managed policy can be attached to
  anything — only inline policies this repository writes;
- `iam:CreateRole` and `iam:PutRolePolicy` carry a condition on `iam:PermissionsBoundary`, so
  a role can only be created with the boundary `bootstrap/` defines, which allows logs, X-Ray
  and `bedrock:InvokeModel` and nothing more.

A final `Deny` statement names the actions that would turn a pipeline compromise into an
account compromise (`iam:CreateUser`, `iam:CreateAccessKey`, `sts:AssumeRole`,
`organizations:*`, deleting the OIDC provider…). A `Deny` cannot be overridden by a later
`Allow`, however this policy is edited afterwards.

## Cost

Nothing. IAM roles and policies are free.
