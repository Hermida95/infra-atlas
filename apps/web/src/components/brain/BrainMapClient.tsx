"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser, so the map is never prerendered.
const BrainMap = dynamic(() => import("./BrainMap"), {
  ssr: false,
  loading: () => <p className="booting">Initializing knowledge core</p>,
});

export default function BrainMapClient() {
  return <BrainMap />;
}
