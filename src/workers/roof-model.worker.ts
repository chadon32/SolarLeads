import { computeRoofModel, roofModelTransferables, type RoofModelJob } from "@/lib/roof-model";

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ id: number; job: RoofModelJob }>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, job } = event.data;
  try {
    const model = computeRoofModel(job);
    scope.postMessage({ id, model }, model ? roofModelTransferables(model) : []);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
};
