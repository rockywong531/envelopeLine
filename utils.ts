import { Position, Feature, LineString } from "geojson";
import * as turf from "@turf/turf";

export const pointKey = (pos: Position) =>
  `${pos[0].toFixed(7)},${pos[1].toFixed(7)}`;

export const multLineToLine = (
  segments: Position[][],
  tolerance: number = 10,
): Position[] => {
  const pointsNearby = (p1: Position, p2: Position): boolean => {
    return turf.distance(p1, p2, { units: "meters" }) < tolerance;
  };

  const orderedPath: Position[] = [];
  const usedSegments = new Set<number>();

  orderedPath.push(segments[0][0]);
  orderedPath.push(segments[0][1]);
  usedSegments.add(0);

  while (usedSegments.size < segments.length) {
    const currentEnd = orderedPath[orderedPath.length - 1];
    let foundNext = false;

    for (let i = 0; i < segments.length; i++) {
      if (usedSegments.has(i)) continue;

      const segment = segments[i];
      if (pointsNearby(currentEnd, segment[0])) {
        orderedPath.push(segment[1]);
        usedSegments.add(i);
        foundNext = true;
        break;
      } else if (pointsNearby(currentEnd, segment[1])) {
        orderedPath.push(segment[0]);
        usedSegments.add(i);
        foundNext = true;
        break;
      }
    }

    if (!foundNext) {
      console.warn("Could not find next connecting segment");
      break;
    }
  }

  const first = orderedPath[0];
  const last = orderedPath[orderedPath.length - 1];
  const dist = turf.distance(turf.point(first), turf.point(last), {
    units: "meters",
  });
  if (dist < tolerance) {
    orderedPath.pop();
    orderedPath.push(first);
  }

  return orderedPath;
};

export const simplifyToMeter = (
  line: Feature<LineString>,
  tolerance: number = 10,
) => {
  const metersToDegrees = (meters: number) => meters / 111320;
  line = turf.simplify(line, {
    tolerance: metersToDegrees(tolerance),
    highQuality: true,
  });
  return line;
};
