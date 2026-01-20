import {
  Position,
  Feature,
  LineString,
  Polygon,
  MultiLineString,
} from "geojson";
import * as turf from "@turf/turf";
import { SkeletonBuilder } from "straight-skeleton";
import { simplify } from "@turf/turf";
import fs from "fs";

export function getCentral(
  feature: Feature<LineString>,
  startPoint: Position,
  endPoint: Position,
): {
  centralLine: Feature<LineString>;
  centralMultiLine: Feature<MultiLineString>;
  centralSkeleton: Feature<MultiLineString>;
} {
  const { extendedEnvelope, endLine } = getExtendedEnvelope(feature, endPoint);
  // fs.writeFileSync(
  //   `results/${feature.properties!.icao}_extended_envelope.json`,
  //   JSON.stringify(extendedEnvelope, null, 2),
  // );

  // Scale up to avoid precision issues
  const scale = 1000000;
  const scaledCoords = extendedEnvelope.geometry.coordinates
    .slice(0, -1)
    .map(([x, y]) => [x * scale, y * scale] as [number, number]);

  const boundaryLine = turf.lineString([...scaledCoords, scaledCoords[0]]);

  const skeleton = SkeletonBuilder.BuildFromGeoJSON([[scaledCoords]] as [
    number,
    number,
  ][][][]);

  const internalEdges = new Map<string, Position[]>();
  const pointMap = new Map<string, Position>();
  const neighMap = new Map<string, Set<string>>();
  const allCoordPairs: [Position, Position][] = [];

  for (let i = 0; i < skeleton.Edges.Count; i++) {
    const edgeResult = skeleton.Edges[i];
    const poly = edgeResult.Polygon;

    for (let j = 0; j < poly.Count; j++) {
      const start = poly[j];
      const end = poly[(j + 1) % poly.Count];

      const p1 = [start.X / scale, start.Y / scale];
      const p2 = [end.X / scale, end.Y / scale];
      allCoordPairs.push([p1, p2]);

      const key = normalizeEdgeKey(start.X, start.Y, end.X, end.Y);

      const startOnBoundary = turf.booleanPointOnLine(
        turf.point([start.X, start.Y]),
        boundaryLine,
        { epsilon: 0.0001 },
      );
      const endOnBoundary = turf.booleanPointOnLine(
        turf.point([end.X, end.Y]),
        boundaryLine,
        { epsilon: 0.0001 },
      );

      if (startOnBoundary || endOnBoundary) continue;
      if (internalEdges.has(key)) continue;

      internalEdges.set(key, [p1, p2]);
      pointMap.set(pointKey(p1), p1);
      pointMap.set(pointKey(p2), p2);
      if (!neighMap.has(pointKey(p1))) neighMap.set(pointKey(p1), new Set());
      if (!neighMap.has(pointKey(p2))) neighMap.set(pointKey(p2), new Set());
      neighMap.get(pointKey(p1))!.add(pointKey(p2));
      neighMap.get(pointKey(p2))!.add(pointKey(p1));
    }
  }

  const centralSkeleton: Feature<MultiLineString> = {
    type: "Feature",
    properties: {
      icao: feature.properties!.icao,
      envelopeId: feature.properties!.id,
      type: "centralSkeleton",
    },
    geometry: {
      type: "MultiLineString",
      coordinates: allCoordPairs,
    },
  };

  // fs.writeFileSync(
  //   `results/${feature.properties!.icao}_skeleton.json`,
  //   JSON.stringify(centralSkeleton, null, 2),
  // );

  const lines = Array.from(internalEdges.values());
  const centralMultiLine: Feature<MultiLineString> = {
    type: "Feature",
    properties: {
      icao: feature.properties!.icao,
      envelopeId: feature.properties!.id,
      type: "centralMultiLine",
    },
    geometry: {
      type: "MultiLineString",
      coordinates: lines,
    },
  };

  fs.writeFileSync(
    `results/${feature.properties!.icao}_central_multiLine.json`,
    JSON.stringify(centralMultiLine, null, 2),
  );

  const extremePoints: Position[] = [];
  neighMap.forEach((neighs, key) => {
    if (neighs.size === 2) return;
    const point = pointMap.get(key)!;
    extremePoints.push(point);
  });

  const lineStart = extremePoints.reduce((prev, curr) => {
    const prevDist = turf.distance(turf.point(prev), turf.point(startPoint), {
      units: "meters",
    });
    const currDist = turf.distance(turf.point(curr), turf.point(startPoint), {
      units: "meters",
    });
    return prevDist < currDist ? prev : curr;
  });

  // // turning end medial line end at the intersection of Y
  // let lineEnd = extremePoints.find((p) => {
  //   const key = pointKey(p);
  //   return neighMap.get(key)!.size === 3;
  // });

  // // straight end medial line
  // if (!lineEnd) {
  //   lineEnd = extremePoints.reduce((prev, curr) => {
  //     const prevDist = turf.distance(turf.point(prev), turf.point(endPoint), {
  //       units: "meters",
  //     });
  //     const currDist = turf.distance(turf.point(curr), turf.point(endPoint), {
  //       units: "meters",
  //     });
  //     return prevDist < currDist ? prev : curr;
  //   });
  // }

  const added = new Set<string>();
  const lineCoords: Position[] = [lineStart];
  added.add(pointKey(lineStart));

  const envelope = turf.lineToPolygon(feature) as Feature<Polygon>;
  let traceEnded = false;

  while (!traceEnded) {
    const lastPoint = lineCoords[lineCoords.length - 1];
    const neighbors = neighMap.get(pointKey(lastPoint))!;

    for (const neighbor of neighbors) {
      if (added.has(neighbor)) continue;

      const neighborPoint = pointMap.get(neighbor)!;
      if (turf.booleanPointInPolygon(turf.point(neighborPoint), envelope)) {
        lineCoords.push(neighborPoint);
        added.add(neighbor);
        break;
      }

      const intersect = turf.lineIntersect(
        turf.lineString([lastPoint, neighborPoint]),
        endLine,
      );

      const error = turf.distance(
        turf.point(intersect.features[0].geometry.coordinates),
        turf.point(endPoint),
        { units: "meters" },
      );
      console.log(
        `intersection and endPoint differ by more than ${error.toFixed(4)}m`,
      );

      lineCoords.push(intersect.features[0].geometry.coordinates);
      traceEnded = true;
      break;
    }
  }

  let centralLine: Feature<LineString> = {
    type: "Feature",
    properties: {
      icao: feature.properties!.icao,
      envelopeId: feature.properties!.id,
      type: "medial",
    },
    geometry: {
      type: "LineString",
      coordinates: [startPoint, ...lineCoords],
    },
  };

  const metersToDegrees = (meters: number) => meters / 111320;
  centralLine = simplify(centralLine, {
    tolerance: metersToDegrees(10),
    highQuality: true,
  });

  return { centralLine, centralMultiLine, centralSkeleton };
}

function normalizeEdgeKey(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  // Round to avoid floating point comparison issues
  const precision = 1000;
  const rx1 = Math.round(x1 * precision) / precision;
  const ry1 = Math.round(y1 * precision) / precision;
  const rx2 = Math.round(x2 * precision) / precision;
  const ry2 = Math.round(y2 * precision) / precision;

  // Sort so smaller point comes first for consistent key
  if (rx1 < rx2 || (rx1 === rx2 && ry1 < ry2)) {
    return `${rx1},${ry1}-${rx2},${ry2}`;
  }
  return `${rx2},${ry2}-${rx1},${ry1}`;
}

const pointKey = (pos: Position) => `${pos[0].toFixed(7)},${pos[1].toFixed(7)}`;

function getExtendedEnvelope(
  feature: Feature<LineString>,
  endPoint: Position,
): {
  extendedEnvelope: Feature<LineString>;
  endLine: Feature<LineString>;
} {
  // Create extended envelope
  // p1                p4
  // |                 |
  // p2________________p3
  let coords = feature.geometry.coordinates
    .slice(0, -1)
    .map(([x, y]) => [x, y] as Position);

  if (turf.booleanClockwise(coords)) {
    coords = coords.reverse();
  }

  const i2 = coords.findIndex((c, i) => {
    const l = turf.lineString([c, coords[(i + 1) % coords.length]]);
    return turf.booleanPointOnLine(turf.point(endPoint), l, {
      epsilon: 0.000001,
    });
  });

  const i1 = (i2 + coords.length - 1) % coords.length;
  const i3 = (i2 + 1) % coords.length;
  const i4 = (i2 + 2) % coords.length;
  const p1 = coords[i1];
  const p2 = coords[i2];
  const p3 = coords[i3];
  const p4 = coords[i4];

  const bearingLeft = turf.bearing(p1, p2);
  const bearingRight = turf.bearing(p4, p3);

  const farP2 = turf.destination(p1, 20, bearingLeft, {
    units: "kilometers",
  });
  const farP3 = turf.destination(p4, 20, bearingRight, {
    units: "kilometers",
  });

  const rayLeft = turf.lineString([p1, farP2.geometry.coordinates]);
  const rayRight = turf.lineString([p4, farP3.geometry.coordinates]);

  const endLine = turf.lineString([p2, p3]);
  const offsetBase = turf.transformTranslate(endLine, 5, bearingLeft, {
    units: "kilometers",
  });
  const extendedBase = turf.transformScale(offsetBase, 10);
  const intersectLeft = turf.lineIntersect(extendedBase, rayLeft);
  const intersectRight = turf.lineIntersect(extendedBase, rayRight);

  const newP2 = intersectLeft.features[0].geometry.coordinates;
  const newP3 = intersectRight.features[0].geometry.coordinates;

  const extendedCoords = [...coords];
  extendedCoords.splice(i2, 2, newP2, newP3);

  const extendedEnvelope: Feature<LineString> = {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: [...extendedCoords, extendedCoords[0]],
    },
  };

  return { extendedEnvelope, endLine };
}
