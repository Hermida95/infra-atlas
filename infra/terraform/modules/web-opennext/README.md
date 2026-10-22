# web-opennext

Phase 1 of decision 2: the statically generated pages of `apps/web` on a **private** S3
bucket, served by CloudFront. Nothing runs, so nothing is billed while nobody is reading.

```
browser --HTTPS--> CloudFront --OAC--> S3 (private, no website endpoint)
                       |
                       \--/api/*------> API Gateway (optional second origin)
```

## Decisions worth knowing

- **The bucket is private and has no website endpoint.** The only thing that can read it is
  this distribution, through an **Origin Access Control** (SigV4) whose bucket policy is
  pinned with `AWS:SourceArn` — so another distribution, even in the same account, cannot read
  it by presenting the CloudFront service principal. OAC rather than the older Origin Access
  Identity: it is the one that works with KMS-encrypted objects.
- **CSP and HSTS live in a response headers policy**, as decision 10 asks. The pages are files
  on S3: there is no server left to add headers, so CloudFront is the only place they can come
  from. The CSP is a variable, because a CSP that does not match the app breaks the page
  silently in the browser rather than loudly in CI.
- **`/api/*` is a second origin**, so the pages and the API share one origin. The browser then
  makes no cross-origin request at all, the CSP stays at `connect-src 'self'`, and the HTTP API
  needs no CORS configuration.
- **Two own cache policies instead of `Managed-CachingOptimized`.** The TTL is the one setting
  worth differing per environment: a minute in dev makes a deploy visible immediately, five
  minutes in prod keeps the origin quiet without making a fix wait. `/_next/static/*` is a
  year, because those filenames carry a content hash and can never go stale. The cache key is
  the path and nothing else — every extra element multiplies the objects the edge stores.
- **`PriceClass_100`**: Europe and North America, the cheapest tier, and where the readers are.
- **403 and 404 both map to `/404.html`.** A private bucket answers 403, not 404, for a key
  that does not exist.
- **TLS floor.** `TLSv1.2_2021` as soon as there is an ACM certificate. Without a custom
  domain, AWS serves the shared `*.cloudfront.net` certificate and pins the policy itself, so
  `TLSv1` is the only value it accepts — not a choice this module makes.

## Deliberately absent

No WAF (~5 USD/month plus per-request charges, against a read-only static site), no access
logging (billed per GB stored and per request; CloudFront's free standard metrics are enough at
this size), no geo restriction (the readers are the point), no origin failover (a second origin
means a second copy of the site to pay for and keep in sync), and no HSTS preload (a one-way
door, and there is no domain yet). Each one is a `checkov:skip` in `main.tf` with its reason.

## The SSR Lambda of phase 3

Not built. [`ssr.tf`](ssr.tf) is a comment-only file listing exactly what gets added when
decision 2's phase 3 turns SSR and middleware on for the paywall, and — more usefully — what
does *not* change: the bucket, the OAC, the headers policy and both existing behaviours. A
half-built SSR path would be worse than none: an origin pointing at a function that does not
exist makes the whole distribution answer 502.

## Cost

CloudFront's free tier is 1 TB out and 10 M requests a month, so realistically zero. S3 storage
for a few MB of assets is cents. The first 1,000 invalidation paths each month are free, which
is why the page TTL is short rather than invalidating on every push.
