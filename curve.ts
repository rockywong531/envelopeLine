import { Point, Position, Feature, LineString } from "geojson";
import fs from "fs";
import Papa from "papaparse";
import * as turf from "@turf/turf";

export function getCurvePoints(
  centralLine: Feature<LineString>,
  envelopeLine: Feature<LineString>,
  takeOffStart: Feature<Point>,
  takeOffEnd: Feature<Point>,
): Feature<Point>[] {
  const icao = envelopeLine.properties!.icao;
  const rwy = envelopeLine.properties!.rwy;
  const envelopeId = envelopeLine.properties!.id;

  const takeOffStartIndex = centralLine.geometry.coordinates.findIndex((c) => {
    const point = turf.point(c);
    return turf.booleanPointOnLine(point, envelopeLine, {
      epsilon: 0.00001,
    });
  });

  // console.log(
  //   "takeOffStart error",
  //   turf.distance(
  //     takeOffStart,
  //     turf.point(centralLine.geometry.coordinates[takeOffStartIndex]),
  //     { units: "meters" },
  //   ),
  // );

  const takeOffEndIndex = centralLine.geometry.coordinates.findLastIndex(
    (c) => {
      const point = turf.point(c);
      return turf.booleanPointOnLine(point, envelopeLine, {
        epsilon: 0.00001,
      });
    },
  );

  // console.log(
  //   "takeOffEnd error",
  //   turf.distance(
  //     takeOffEnd,
  //     turf.point(centralLine.geometry.coordinates[takeOffEndIndex]),
  //     { units: "meters" },
  //   ),
  // );

  const turn: Feature<Point> = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [],
    },
    properties: {
      icao,
      rwy,
      envelopeId,
      "marker-color": "#00FF00",
      "marker-size": "small",
    },
  };

  const autoTurn1: Feature<Point> = {
    ...turn,
    properties: {
      ...turn.properties,
      type: "autoTurn1",
    },
    geometry: {
      ...turn.geometry,
      coordinates: centralLine.geometry.coordinates[takeOffStartIndex + 1],
    },
  };

  const autoTurn2: Feature<Point> = {
    ...turn,
    properties: {
      ...turn.properties,
      type: "autoTurn2",
    },
    geometry: {
      ...turn.geometry,
      coordinates: centralLine.geometry.coordinates[takeOffEndIndex - 1],
    },
  };

  const curvePoints: Feature<Point>[] = [autoTurn1, autoTurn2];

  const csvData = fs.readFileSync("./resources/envelopeTurns.csv", "utf-8");
  const allRwyTurnInfo = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: (col) => col !== "Runway",
  }).data as any[];

  const rwyTurnInfo = allRwyTurnInfo.find(
    (t) => t.Runway === rwy && t.ICAO === icao,
  );

  const centralInEnvelope = {
    ...centralLine,
    geometry: {
      ...centralLine.geometry,
      coordinates: centralLine.geometry.coordinates.slice(
        takeOffStartIndex,
        takeOffEndIndex + 1,
      ),
    },
  };

  console.log(
    "central in envelope",
    icao,
    rwy,
    turf.length(centralInEnvelope, { units: "nauticalmiles" }),
    "nm",
  );

  const dist1: number = rwyTurnInfo["Turning start2 (NM)"];
  const dist2: number = rwyTurnInfo["Turning end (NM)"];
  if (dist1) {
    const distTurn1 = getPointAtDistance(centralInEnvelope, dist1);
    distTurn1.properties!.type = "distTurn1";
    distTurn1.properties!["marker-color"] = "#F4C430";
    distTurn1.properties!.name = "BT";
    curvePoints.push(distTurn1);
  }
  if (dist2) {
    const distTurn2 = getPointAtDistance(centralInEnvelope, dist2);
    distTurn2.properties!.type = "distTurn2";
    distTurn2.properties!["marker-color"] = "#E0115F";
    distTurn2.properties!.name = "ET";
    curvePoints.push(distTurn2);
  }

  return curvePoints;
}

function getPointAtDistance(
  feature: Feature<LineString>,
  distance: number,
): Feature<Point> {
  const point = turf.along(feature, distance, { units: "nauticalmiles" });
  return {
    ...point,
    properties: {
      ...point.properties,
      icao: feature.properties!.icao,
      rwy: feature.properties!.rwy,
      envelopeId: feature.properties!.envelopeId,
      "marker-size": "small",
      "marker-symbol": "rocket",
    },
  };
}

// export function detectCurveTransitions(path: Position[]): {
//   curveStart: number;
//   curveEnd: number;
// } {

//   const curvatures: number[] = [];

//   // Calculate curvature at each point
//   for (let i = 1; i < path.length - 1; i++) {
//     const prev = path[i - 1];
//     const curr = path[i];
//     const next = path[i + 1];
//     curvatures.push(calculateCurvature(prev, curr, next));
//   }

//   // Calculate rate of change of curvature (derivative of curvature)
//   const curvatureDerivatives: number[] = [];
//   for (let i = 1; i < curvatures.length; i++) {
//     const derivative = Math.abs(curvatures[i] - curvatures[i - 1]);
//     curvatureDerivatives.push(derivative);
//   }

//   // Smooth the derivatives to reduce noise
//   const smoothed = smoothCurve(curvatureDerivatives, 5);

//   // Find peaks in curvature change
//   const peaks = findPeaks(smoothed, 0.0001); // Threshold for significant change

//   if (peaks.length >= 2) {
//     return {
//       curveStart: peaks[0] + 1,
//       curveEnd: peaks[peaks.length - 1] + 1
//     };
//   }

//   // Fallback: use first/last significant curvature
//   const threshold = Math.max(...curvatures) * 0.2; // 20% of max curvature

//   let curveStart = curvatures.findIndex(k => k > threshold);
//   let curveEnd = curvatures.length - 1 -
//     [...curvatures].reverse().findIndex(k => k > threshold);

//   return {
//     curveStart: curveStart + 1,
//     curveEnd: curveEnd + 1
//   };
// }

// function smoothCurve(arr: number[], windowSize: number): number[] {
//   const result: number[] = [];
//   for (let i = 0; i < arr.length; i++) {
//     const start = Math.max(0, i - Math.floor(windowSize / 2));
//     const end = Math.min(arr.length, i + Math.ceil(windowSize / 2));
//     const sum = arr.slice(start, end).reduce((a, b) => a + b, 0);
//     result.push(sum / (end - start));
//   }
//   return result;
// }

// function findPeaks(arr: number[], threshold: number): number[] {
//   const peaks: number[] = [];
//   for (let i = 1; i < arr.length - 1; i++) {
//     if (arr[i] > threshold &&
//         arr[i] > arr[i - 1] &&
//         arr[i] > arr[i + 1]) {
//       peaks.push(i);
//     }
//   }
//   return peaks;
// }

// function calculateCurvature(p1: Position, p2: Position, p3: Position): number {
//   // Using Menger curvature formula for three points
//   // κ = 4 * Area(triangle) / (|p1-p2| * |p2-p3| * |p3-p1|)

//   // Calculate triangle area using cross product
//   const v1 = [p2[0] - p1[0], p2[1] - p1[1]];
//   const v2 = [p3[0] - p1[0], p3[1] - p1[1]];
//   const area = Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) / 2;

//   // Calculate side lengths
//   const d12 = Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
//   const d23 = Math.sqrt(Math.pow(p3[0] - p2[0], 2) + Math.pow(p3[1] - p2[1], 2));
//   const d31 = Math.sqrt(Math.pow(p1[0] - p3[0], 2) + Math.pow(p1[1] - p3[1], 2));

//   if (d12 * d23 * d31 === 0) return 0;

//   const curvature = 4 * area / (d12 * d23 * d31);

//   return curvature;
// }
