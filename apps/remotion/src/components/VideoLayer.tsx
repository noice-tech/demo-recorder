import { Video } from "@remotion/media";

export type VideoLayerProps = {
  src: string;
  width: number;
  height: number;
  trimBefore?: number;
  trimAfter?: number;
};

export function VideoLayer({ src, width, height, trimBefore, trimAfter }: VideoLayerProps) {
  return (
    <Video
      muted
      src={src}
      objectFit="fill"
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
      }}
    />
  );
}
