import type { Metadata } from "next";
import { NodePage, nodeMetadata } from "@/components/atlas/NodePage";
import { AWS_ATLAS } from "@/lib/aws";

/** One page per AWS service. The shape is in components/atlas/NodePage. */
export function generateStaticParams() {
  return AWS_ATLAS.world.graph.nodes.map((n) => ({ id: n.id }));
}

export function generateMetadata({ params }: PageProps<"/aws/[id]">): Promise<Metadata> {
  return nodeMetadata(AWS_ATLAS, params);
}

export default function AwsServicePage({ params }: PageProps<"/aws/[id]">) {
  return <NodePage atlas={AWS_ATLAS} params={params} />;
}
