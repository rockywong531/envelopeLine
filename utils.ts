import { Position, Feature, LineString, Polygon, FeatureCollection } from "geojson";
import * as turf from "@turf/turf";

export const pointKey = (pos: Position) =>
  `${pos[0].toFixed(7)},${pos[1].toFixed(7)}`;

export const multiLineToLine = (
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

const metersToDegrees = (meters: number) => meters / 111320;

export const simplifyLine = (
  feature: Feature<LineString>,
  tolerance: number = 10,
): Feature<LineString> => {
  const result = turf.simplify(feature, {
    tolerance: metersToDegrees(tolerance),
    highQuality: true,
  });
  return result;
};

function rotateArray<T>(nums: T[], k: number): T[] {
  const n = nums.length;
  // Ensure k is within the bounds of the array length
  k = k % n;
  if (k === 0) return nums;

  // Slice the array into two parts and concatenate them in reverse order
  const rotated: T[] = nums.slice(-k).concat(nums.slice(0, -k));
  return rotated;
}

// rotate the avoid first coordinate to be the redundant point
export const simplifyClosedLine = (
  feature: Feature<LineString>,
  tolerance: number = 10,
): Feature<LineString> => {
  const metersToDegrees = (meters: number) => meters / 111320;
  const options = { tolerance: metersToDegrees(tolerance), highQuality: true };

  const coords = feature.geometry.coordinates;
  const ring = coords.slice(0, -1);

  // Try a few rotations: 0, 1/4, 1/2, 3/4 of the way through
  const pivots = [
    0,
    Math.floor(ring.length / 4),
    Math.floor(ring.length / 2),
    Math.floor(3 * ring.length / 4),
  ];

  let bestResult: Feature<LineString> | null = null;
  let minPoints = Infinity;

  for (const pivot of pivots) {
    const rotated = [...ring.slice(pivot), ...ring.slice(0, pivot)];
    rotated.push(rotated[0]);

    const candidate = turf.simplify(
      { ...feature, geometry: { ...feature.geometry, coordinates: rotated } },
      options,
    );

    const pointCount = candidate.geometry.coordinates.length;
    if (pointCount < minPoints) {
      minPoints = pointCount;
      bestResult = candidate;
    }
  }

  return bestResult!;
};

export const getEnvelopeId = (input: Feature | FeatureCollection) => {
  const feature = "features" in input ? input.features[0] : input;
  const properties = feature.properties;
  const icao = properties!.icao;
  const rwy = properties!.rwy;
  const seq = properties!.seq;
  return seq ? `${icao}_${rwy}_${seq}` : `${icao}_${rwy}`;
}
