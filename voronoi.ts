import * as turf from "@turf/turf";
import {
  FeatureCollection,
  LineString,
  Feature,
  Polygon,
  Point,
  Position,
  MultiLineString,
} from "geojson";
import fs from "fs";

export interface Edge {
  start: Position;
  end: Position;
}

export function createVoronoi(envelopeCoords: Position[]): {
  voronoi: FeatureCollection<Polygon>;
  envelope: Feature<Polygon>;
} {
  const envelope = turf.polygon([envelopeCoords]);
  const bbox = turf.bbox(envelope);

  // Step 1: Sample boundary and create Voronoi
  const perimeter: Feature<Point>[] = [];
  const envelopeLine = turf.polygonToLine(envelope) as Feature<LineString>;

  const length = turf.length(envelopeLine, { units: "meters" });
  const numPoints = Math.ceil(length / 120);

  for (let i = 0; i <= numPoints; i++) {
    const distance = (i / numPoints) * length;
    const point = turf.along(envelopeLine, distance, { units: "meters" });
    perimeter.push(point);
  }

  const pointsFC = turf.featureCollection(perimeter);
  const voronoi = turf.voronoi(pointsFC, {
    bbox: [bbox[0] - 0.01, bbox[1] - 0.01, bbox[2] + 0.01, bbox[3] + 0.01],
  });

  return { voronoi, envelope };
}

export function getEdgesInEnvelope(
  voronoi: FeatureCollection<Polygon>,
  envelope: Feature<Polygon>,
): Edge[] {
  const edges: Edge[] = [];
  const envelopeLine = turf.polygonToLine(envelope) as Feature<LineString>;

  voronoi.features.forEach((voronoiCell) => {
    const cellCoords: Position[] = voronoiCell.geometry.coordinates[0];

    // Each cell is a polygon - extract its edges
    for (let i = 0; i < cellCoords.length - 1; i++) {
      const start = cellCoords[i];
      const end = cellCoords[i + 1];

      const startPoint = turf.point(start);
      const endPoint = turf.point(end);

      // Check if BOTH endpoints are inside original polygon
      const startInside = turf.booleanPointInPolygon(startPoint, envelope);
      const endInside = turf.booleanPointInPolygon(endPoint, envelope);

      const startDist = turf.pointToLineDistance(startPoint, envelopeLine, {
        units: "degrees",
      });
      const endDist = turf.pointToLineDistance(endPoint, envelopeLine, {
        units: "degrees",
      });
      const avgDist = (startDist + endDist) / 2;

      if (startInside && endInside && avgDist > 0.001) {
        edges.push({
          start,
          end,
        });
      }
    }
  });

  return edges;
}

interface NeighborPath {
  dist: number;
  path: Position[];
}

function dfs(
  node: string,
  parent: string | null,
  graph: Map<string, Set<string>>,
  pointToCoord: Map<string, Position>,
): { length: number; path: Position[] } {
  let maxLen = 0;
  let maxPath: Position[] = [];

  const nodeCoord = pointToCoord.get(node)!;
  const neighbors = graph.get(node)!;
  const neighborPaths: NeighborPath[] = [];

  for (const neighbor of neighbors) {
    if (neighbor === parent) continue;

    const { length, path } = dfs(neighbor, node, graph, pointToCoord);

    const neighborCoord = pointToCoord.get(neighbor)!;
    const edgeDist = turf.distance(
      turf.point(nodeCoord),
      turf.point(neighborCoord),
      { units: "meters" },
    );
    const neigborLen = length + edgeDist;
    neighborPaths.push({
      dist: neigborLen,
      path: [neighborCoord, ...path],
    });

    if (maxLen < neigborLen) {
      maxLen = neigborLen;
      maxPath = path;
    }
  }
  // const neighLenList = neighborPaths.map((np) => np.dist);
  // if (neighLenList.length > 1) {
  //   console.log(
  //     `Node ${node} has multiple branches with lengths: ${neighLenList.join(
  //       ", "
  //     )}`
  //   );
  // }

  if (neighborPaths.length === 0) {
    return { length: 0, path: [] };
  }

  if (neighborPaths.length === 1) {
    return {
      length: maxLen,
      path: [nodeCoord, ...maxPath],
    };
  }

  // Get the medial path at the middle of the ending Y shape
  const mean =
    neighborPaths.reduce((acc, np) => acc + np.dist, 0) / neighborPaths.length;
  const inThreshold = neighborPaths.every(
    (np) => Math.abs(np.dist - mean) < 250,
  );
  if (inThreshold) {
    const lastPoints = neighborPaths.map((np) => np.path[np.path.length - 1]);
    const meanPoint = turf.centroid(
      turf.featureCollection(lastPoints.map((p) => turf.point(p))),
    );
    const meanCoord = meanPoint.geometry.coordinates as Position;
    const edgeDist = turf.distance(
      turf.point(nodeCoord),
      turf.point(meanCoord),
      { units: "meters" },
    );

    return {
      length: edgeDist,
      path: [nodeCoord, meanCoord],
    };
  }

  return {
    length: maxLen,
    path: [nodeCoord, ...maxPath],
  };
}

function smoothLine(line: Feature<LineString>, windowSize = 3) {
  const coords = line.geometry.coordinates;
  const smoothedCoords = [];

  // Keep the start point fixed
  smoothedCoords.push(coords[0]);

  for (let i = 1; i < coords.length - 1; i++) {
    let sumLon = 0;
    let sumLat = 0;
    let count = 0;

    // create a sliding window around the current point
    for (
      let j = Math.max(0, i - windowSize);
      j <= Math.min(coords.length - 1, i + windowSize);
      j++
    ) {
      sumLon += coords[j][0];
      sumLat += coords[j][1];
      count++;
    }

    smoothedCoords.push([sumLon / count, sumLat / count]);
  }

  // Keep the end point fixed
  smoothedCoords.push(coords[coords.length - 1]);

  return turf.lineString(smoothedCoords);
}

export function extractMedialFromEdges(
  edges: Edge[],
  takeOffStart: Position,
  takeOffEnd: Position,
  polygon: Feature<Polygon>,
): {
  medialPath: Feature<LineString>;
  multiPath: Feature<MultiLineString>;
} {
  const graph = new Map<string, Set<string>>();
  const pointToCoord = new Map<string, Position>();
  const fullCoords: Position[][] = [];

  const getKey = (pos: Position) => `${pos[0].toFixed(7)},${pos[1].toFixed(7)}`;
  const getEdgeKey = (p1: Position, p2: Position) => {
    const k1 = `${p1[0].toFixed(7)},${p1[1].toFixed(7)}`;
    const k2 = `${p2[0].toFixed(7)},${p2[1].toFixed(7)}`;
    return [k1, k2].sort().join("|");
  };

  const edgeMap = new Map<
    string,
    {
      edge: [Position, Position];
      cells: number;
    }
  >();

  edges.forEach((edge) => {
    const edgeKey = getEdgeKey(edge.start, edge.end);
    if (!edgeMap.has(edgeKey)) {
      edgeMap.set(edgeKey, { edge: [edge.start, edge.end], cells: 0 });
    }
    edgeMap.get(edgeKey)!.cells++;
  });

  edges.forEach((edge) => {
    const edgeKey = getEdgeKey(edge.start, edge.end);
    const count = edgeMap.get(edgeKey)!.cells;
    if (count < 2) return;

    const startKey = getKey(edge.start);
    const endKey = getKey(edge.end);

    pointToCoord.set(startKey, edge.start);
    pointToCoord.set(endKey, edge.end);

    fullCoords.push([edge.start, edge.end]);

    if (!graph.has(startKey)) graph.set(startKey, new Set());
    if (!graph.has(endKey)) graph.set(endKey, new Set());

    graph.get(startKey)!.add(endKey);
    graph.get(endKey)!.add(startKey);
  });

  fs.writeFileSync(
    "results/full.json",
    JSON.stringify(turf.multiLineString(fullCoords), null, 2),
  );

  let startNode: string = "";
  let minDistToStart = Infinity;
  for (const [key, coord] of pointToCoord) {
    const dist = turf.distance(turf.point(takeOffStart), turf.point(coord));
    if (dist < minDistToStart) {
      minDistToStart = dist;
      startNode = key;
    }
  }

  const { path } = dfs(startNode, null, graph, pointToCoord);

  // find median end
  const bearing = turf.bearing(
    turf.point(path[path.length - 2]),
    turf.point(path[path.length - 1]),
  );
  const distantPoint = turf.destination(
    turf.point(path[path.length - 1]),
    15,
    bearing,
    { units: "kilometers" },
  );
  const ray = turf.lineString([
    path[path.length - 1],
    distantPoint.geometry.coordinates,
  ]);
  const intersections = turf.lineIntersect(ray, polygon);
  const endPoint = intersections.features[0].geometry.coordinates as Position;
  path.unshift(takeOffStart);
  path.push(endPoint);

  const medialPath = smoothLine(turf.lineString(path));

  return {
    medialPath,
    multiPath: turf.multiLineString(fullCoords),
  };
}

export function getMedialPath(
  feature: Feature<LineString>,
  takeOffStart: Feature<Point>,
  takeOffEnd: Feature<Point>,
) {
  const { voronoi, envelope } = createVoronoi(feature.geometry.coordinates);
  const edgesInEnvelope = getEdgesInEnvelope(voronoi, envelope);

  const { medialPath } = extractMedialFromEdges(
    edgesInEnvelope,
    takeOffStart.geometry.coordinates,
    takeOffEnd.geometry.coordinates,
    envelope,
  );

  const error = turf.distance(
    takeOffEnd,
    medialPath.geometry.coordinates[medialPath.geometry.coordinates.length - 1],
    { units: "meters" },
  );

  const icao = feature.properties!.icao;
  const envelopeId = feature.properties!.id;
  if (error > 500) {
    console.log(`${icao} id: ${envelopeId} - error: ${error}`);
  }

  medialPath.properties = {
    ...medialPath.properties,
    icao,
    envelopeId,
  };

  return medialPath;
}
