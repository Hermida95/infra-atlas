// CloudFront Function, viewer-request, attached to the default (pages) behaviour.
//
// Why it exists: `next build` with output: "export" and trailingSlash: true writes a tree of
// directories -- out/c/pipeline/index.html -- and S3 has no notion of a default document
// inside a prefix. default_root_object on the distribution only covers "/", so every concept
// URL would reach S3 as the key "c/pipeline/", which does not exist: a 403, turned by the
// custom_error_response below into a 404 page. The site would look broken everywhere except
// the home page, with a green apply behind it.
//
// Two shapes have to work, because both are typed and both are linked:
//   /c/pipeline/  -> c/pipeline/index.html   (what Next emits and links to)
//   /c/pipeline   -> c/pipeline/index.html   (what a person types, or an old link holds)
// Anything carrying a file extension is left alone: /favicon.ico and /_next/static/*.js are
// real keys in the bucket and must not be rewritten.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (!uri.split("/").pop().includes(".")) {
    request.uri = uri + "/index.html";
  }

  return request;
}
