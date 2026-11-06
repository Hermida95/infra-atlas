import { AtlasPage, atlasMetadata } from "@/components/atlas/AtlasPage";
import { K8S_ATLAS } from "@/lib/k8s";

export const metadata = atlasMetadata(K8S_ATLAS);

export default function K8sPage() {
  return <AtlasPage atlas={K8S_ATLAS} />;
}
