import type { Metadata } from "next";
import AwsAtlas from "@/components/aws/AwsAtlas";
import { AWS, EXAM_LABEL } from "@/lib/aws";

export const metadata: Metadata = {
  title: "Inside AWS · Infra Atlas",
  description:
    "A 3D map of the AWS services the Solutions Architect Associate and Professional exams cover, " +
    "how each one connects to the next, and real cases with the options to solve them.",
  openGraph: {
    title: "Inside AWS · Infra Atlas",
    description:
      "Every AWS service of the SAA-C03 and SAP-C02 scope as a map, with real cases and the " +
      "options to solve each one.",
  },
};

export default function AwsPage() {
  return (
    <main>
      <h1 className="sr-only">
        Inside AWS: a 3D map of the services the SAA-C03 and SAP-C02 exams cover
      </h1>
      <AwsAtlas />
      {/* Text version of the atlas, for screen readers and search engines. */}
      <div className="sr-only">
        {AWS.graph.domains.map((domain) => (
          <section key={domain.id}>
            <h2>{domain.name}</h2>
            <ul>
              {AWS.graph.nodes
                .filter((n) => n.domain === domain.id)
                .map((n) => (
                  <li key={n.id}>
                    {n.title}
                    {n.exam.length > 0 && ` (${n.exam.map((e) => EXAM_LABEL[e]).join(", ")})`}:{" "}
                    {n.summary}
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <h2>Cases</h2>
        <ul>
          {AWS.graph.cases.map((c) => (
            <li key={c.id}>
              <h3>{c.title}</h3>
              <p>{c.scenario}</p>
              <ul>
                {c.options.map((o) => (
                  <li key={o.id}>
                    {o.name} — {o.verdict}: {o.why}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
