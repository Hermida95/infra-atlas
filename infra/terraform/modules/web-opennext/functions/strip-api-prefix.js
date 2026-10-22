// CloudFront Function, viewer-request, attached to the /api/* behaviour.
//
// Why it exists: CloudFront forwards the URI it received, so a browser asking for
// /api/search reaches API Gateway as /api/search -- and FastAPI (apps/api) routes /search,
// /graph, /plan, /health, /ready. Without this, every API call through the CDN is a 404 from
// the application, which is the kind of mistake that only shows up once the whole stack is
// deployed.
//
// The alternatives, and why not:
//   - rewrite in the application (uvicorn --root-path): it changes behaviour that Compose and
//     the kind cluster do not have, so the same image would no longer behave the same way in
//     all three places, which is the whole point of decision 5;
//   - a second API Gateway stage named "api": a stage is a path segment, so the gateway would
//     serve /api/search only by renaming the stage, and $default is what makes the endpoint
//     URL clean;
//   - let the browser call the execute-api URL directly: that is a cross-origin request, which
//     means CORS and a CSP with connect-src pointing at a second host.
//
// A CloudFront Function runs at the edge in under a millisecond and costs 0.10 USD per million
// invocations. The prefix is hardcoded on purpose: it has to match the path_pattern of the
// behaviour this is attached to, and two places that must agree are better read side by side
// than threaded through a variable.
function handler(event) {
  var request = event.request;

  if (request.uri === "/api" || request.uri === "/api/") {
    request.uri = "/";
  } else if (request.uri.startsWith("/api/")) {
    request.uri = request.uri.slice(4);
  }

  return request;
}
