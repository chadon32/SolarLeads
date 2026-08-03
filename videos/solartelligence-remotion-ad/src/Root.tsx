import { Composition } from "remotion";
import { SolartelligenceFacebookAd } from "./SolartelligenceFacebookAd";

export const RemotionRoot = () => (
  <Composition
    id="SolartelligenceFacebookAd"
    component={SolartelligenceFacebookAd}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
  />
);
