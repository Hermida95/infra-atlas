# Phase 3: server-side rendering. Prepared, not built.
#
# Decision 2 splits the hosting of the web app in two. Phase 1 (what main.tf builds) serves
# only statically generated pages from S3: there is nothing to run, so there is nothing that
# can cost money while nobody is reading. Phase 3 turns SSR and middleware on, because the
# paywall needs a request to be able to look at a session before it decides what to send.
#
# This file is empty on purpose. A half-built SSR path is worse than none: an origin pointing
# at a function that does not exist makes the whole distribution return 502, and
# `enable_ssr = false` branches would double the module's surface for a feature nobody can
# exercise yet. When phase 3 starts, what gets added here is:
#
#   1. aws_lambda_function.server
#      The OpenNext "server function" bundle (zip, not an image: it is ~20 MB of JS, and a
#      zip package cold-starts in ~300 ms instead of the 1-2 s a container image takes --
#      docs/SEGURIDAD.md, finding D3). Built by `npx open-next@<pinned> build` in
#      deploy.yml, which emits .open-next/server-functions/default.
#
#   2. aws_lambda_function_url.server
#      With AWS_IAM auth, so only this distribution can invoke it. A Function URL rather than
#      a second API Gateway: no per-request gateway charge, and OpenNext expects streaming.
#      It becomes a second origin here, with the OAC below, and takes over
#      default_cache_behavior; /_next/static/* stays on S3.
#
#   3. aws_cloudfront_origin_access_control.server
#      origin_access_control_origin_type = "lambda", signing_behavior = "always". Same idea
#      as the S3 one: the function is not callable from the internet directly.
#
#   4. aws_lambda_function.image_optimization
#      next/image resizes on demand. Needed as soon as a page uses <Image>; the atlas is
#      SVG icons and three.js today, so nothing calls it.
#
#   5. A cache policy that forwards the cookies the middleware reads, and a behaviour for
#      /api/auth/* if Cognito's hosted UI is used (decision 7).
#
# What does NOT change when this lands: the bucket, the OAC, the response headers policy, the
# /_next/static/* behaviour and the /api/* behaviour. That is the point of adding it here
# rather than replacing this module later.
#
# Cost to expect: the server function is billed per request and per GB-second like the API,
# so an idle site still costs nothing; the risk is a crawler walking every page. The same two
# guards apply as in modules/api-lambda -- reserved concurrency and a short timeout.
