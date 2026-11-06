import { AtlasPage, atlasMetadata } from "@/components/atlas/AtlasPage";
import { AWS_ATLAS } from "@/lib/aws";

export const metadata = atlasMetadata(AWS_ATLAS);

export default function AwsPage() {
  return <AtlasPage atlas={AWS_ATLAS} />;
}
