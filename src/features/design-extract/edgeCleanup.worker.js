import { cleanDesignEdges } from "@/lib/designEdgeCleanup";

self.onmessage = ({ data }) => {
  try {
    const pixels = cleanDesignEdges(new Uint8ClampedArray(data.pixels), data.width, data.height, data.settings);
    self.postMessage({ id: data.id, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
