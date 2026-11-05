import type { Metadata } from "next";
import { NodePage, nodeMetadata } from "@/components/atlas/NodePage";
import { K8S_ATLAS } from "@/lib/k8s";

/** One page per Kubernetes object. The shape is in components/atlas/NodePage. */
export function generateStaticParams() {
  return K8S_ATLAS.world.graph.nodes.map((n) => ({ id: n.id }));
}

export function generateMetadata({ params }: PageProps<"/k8s/[id]">): Promise<Metadata> {
  return nodeMetadata(K8S_ATLAS, params);
}

export default function K8sObjectPage({ params }: PageProps<"/k8s/[id]">) {
  return <NodePage atlas={K8S_ATLAS} params={params} />;
}
