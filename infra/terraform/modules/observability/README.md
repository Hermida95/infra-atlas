# observability

The two things worth being woken up for on a 1–5 €/month project: the bill is growing, and the
API is returning 5xx. Both land on one SNS topic, so there is one place to add a second
channel later.

## AWS Budgets

Decision 10 and the cost table in [docs/DECISIONES.md](../../../../docs/DECISIONES.md) ask for
alarms at **5 €** and **10 €**. Each budget notifies twice:

| Notification | Meaning |
| --- | --- |
| `ACTUAL >= 100%` | the money is already spent |
| `FORECASTED >= 80%` (prod) | the month is on course to get there — the one that arrives in time to act |

Credits and refunds are excluded, so free-tier credits cannot hide real spend: a budget that
only warns once the credits run out warns too late.

`budget_thresholds` is empty by default, and `envs/dev` leaves it empty. A budget with no cost
filter measures the **whole account**, so a second environment would only duplicate the same
number — and AWS gives two budgets free and bills 0.02 USD/day for each one after that. Two
budgets, in prod, covering everything.

## The 5xx alarm

`AWS/ApiGateway` → `5xx`, summed over the stage. Three details that are easy to get wrong:

- **The metric name differs by API type.** HTTP APIs publish `5xx`; REST APIs publish
  `5XXError`. Picking the wrong one builds an alarm that never fires.
- **`Sum`, not `Average`.** Averaging a period with two requests, one failing, gives 0.5 —
  which never crosses a threshold expressed in responses.
- **`treat_missing_data = "notBreaching"`.** An API nobody called publishes no datapoints, and
  "no traffic" must not look like "broken". The cost of that choice: this alarm cannot detect
  an outage that stops traffic reaching the gateway at all. That needs a synthetic check, which
  is a recurring charge.

The threshold is not zero, in either environment. A single cold start that times out, or one
Lambda init failure, would otherwise page on a perfectly healthy deployment.

## Email subscriptions are not done when `apply` is

AWS emails a confirmation link and the subscription stays `PendingConfirmation` until somebody
clicks it. An unconfirmed subscription is the usual reason an alarm "did not fire", so the
addresses still waiting are an output: `pending_email_confirmations`.

## Cost

The topic, the subscriptions and up to two budgets are free; the alarm is 0.10 USD/month after
the ten free ones.

## Why the topic has no encryption at rest

Not a cost decision, although a customer-managed key would also cost 1 USD/month. **CloudWatch
Alarms cannot publish to a topic encrypted with `alias/aws/sns`**: the publish needs
`kms:GenerateDataKey` and `kms:Decrypt` for `cloudwatch.amazonaws.com` in the *key* policy, and
the AWS-managed key's policy is AWS's and cannot be edited. The topic policy says yes, KMS says
no, and a failed alarm action is not retried and raises nothing of its own — so the 5xx alarm
would sit in `ALARM` with no mail ever arriving. That is the worst available outcome for the
one mechanism that tells you the bill is running away.

A customer-managed key is the fix if the contents ever justify it. Today the topic carries two
sentences ("your bill went over 5 euros", "the API is returning 5xx") that give away nothing a
reader of the public site does not already have, and SNS still encrypts them in transit.
