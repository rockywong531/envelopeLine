import * as turf from "@turf/turf";
import {
  Feature,
  LineString,
  Position,
  Polygon,
  FeatureCollection,
  MultiPolygon,
  Point,
} from "geojson";
import Papa from "papaparse";
import fs from "fs";
import { nanoid } from "nanoid";

import { detectCurveTransitions } from "./curve";

export function assignIcao(col: turf.AllGeoJSON): FeatureCollection {
  const file = fs.readFileSync("resources/airports.csv", "utf-8");
  let apInfo = Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
  }).data as any[];

  const nonAirBaseReg = /air ?base$/i;
  apInfo = apInfo.filter(
    (ap) =>
      ap.iso_country === "JP" &&
      ap.ident.startsWith("RJ") &&
      ap.type.endsWith("airport") &&
      !nonAirBaseReg.test(ap.name)
  );

  let flattened = turf.flatten(col);
  const cleaned = flattened.features.map((f) => {
    return turf.cleanCoords(f);
  });
  flattened = turf.featureCollection(cleaned);

  flattened.features = flattened.features.filter(
    (f) => f.geometry.coordinates.length >= 4
  );

  flattened.features.forEach((feature) => {
    const polygon = turf.lineToPolygon(feature);
    const centre = turf.center(polygon).geometry.coordinates;

    let dist = Infinity;
    let nearestIcao = "";
    let nearestName = "";

    for (const ap of apInfo) {
      const distance = turf.distance(
        turf.point(centre),
        turf.point([parseFloat(ap.longitude_deg), parseFloat(ap.latitude_deg)]),
        { units: "kilometers" }
      );

      if (distance < dist) {
        dist = distance;
        nearestIcao = ap.ident;
        nearestName = ap.name;
      }
    }

    feature.properties = {
      ...feature.properties,
      icao: nearestIcao,
      airportName: nearestName,
      id: nanoid(),
    };

    console.log(
      `Assigned ICAO ${nearestIcao} to feature at ${centre} (distance: ${dist.toFixed(
        2
      )} km)`
    );
  });

  const uniqueFeatures: Feature<LineString>[] = [];
  for (const feature of flattened.features) {
    const duplicated = uniqueFeatures.some((uf) => {
      const similarity = getEnvelopeSimilarity(
        uf as Feature<LineString>,
        feature as Feature<LineString>
      );
      return similarity >= 0.95;
    });

    if (!duplicated) {
      uniqueFeatures.push(feature);
    }
  }

  return turf.featureCollection(uniqueFeatures);
}

export function getEnvelopeByIcao(
  geoData: FeatureCollection<LineString>,
  icao?: string
): FeatureCollection<LineString> {
  const features = geoData.features.filter((feature: any) => {
    const lineString = feature.geometry?.type === "LineString";
    return icao ? lineString && feature.properties!.icao === icao : lineString;
  });

  return turf.featureCollection(features);
}

function getCornerAngle(p1: Position, p2: Position, p3: Position): number {
  const bearing1 = turf.bearing(turf.point(p2), turf.point(p1));
  const bearing2 = turf.bearing(turf.point(p2), turf.point(p3));
  let angle = Math.abs(bearing1 - bearing2);
  if (angle > 180) {
    angle = 360 - angle;
  }
  return angle;
}

function getEnvelopeSimilarity(
  env1: Feature<LineString>,
  env2: Feature<LineString>
): number {
  const poly1 = turf.lineToPolygon(env1);
  const poly2 = turf.lineToPolygon(env2);

  const collection = turf.featureCollection<Polygon | MultiPolygon>([
    poly1,
    poly2,
  ]);

  // 1. Calculate Intersection
  const intersection = turf.intersect(collection);
  if (!intersection) return 0;

  // 2. Calculate Union
  const combined = turf.union(collection);
  if (!combined) return 0;

  // 3. IoU Calculation
  const areaIntersection = turf.area(intersection);
  const areaUnion = turf.area(combined);
  return areaIntersection / areaUnion;
}

export function getTakeOffEdge(feature: Feature<LineString>):
  | {
      start: Position[];
      end: Position[];
    }
  | undefined {
  interface ScoreSegment {
    index: number;
    p1: Position;
    p2: Position;
    angleSum: number;
    angle1: number;
    angle2: number;
    dist: number;
  }

  if (feature.geometry.coordinates.length < 4) return;

  const coords = feature.geometry.coordinates.slice(0, -1);
  const scoredSegments: ScoreSegment[] = [];

  for (let i = 0; i < coords.length; i++) {
    const p1 = coords.at(i)!;
    const p2 = coords.at((i + 1) % coords.length)!;
    const p0 = coords.at(i - 1)!;
    const p3 = coords.at((i + 2) % coords.length)!;

    const angle1 = getCornerAngle(p0, p1, p2);
    const angle2 = getCornerAngle(p1, p2, p3);
    const angleSum = angle1 + angle2;

    scoredSegments.push({
      index: i,
      p1,
      p2,
      angleSum,
      angle1,
      angle2,
      dist: turf.length(turf.lineString([p1, p2])),
    });
  }

  scoredSegments.sort((a, b) => a.angleSum - b.angleSum);
  const s1 = scoredSegments[0];
  const s2 = scoredSegments[1];
  const l1 = turf.length(turf.lineString([s1.p1, s1.p2]));
  const l2 = turf.length(turf.lineString([s2.p1, s2.p2]));
  return l1 < l2
    ? {
        start: [s1.p1, s1.p2],
        end: [s2.p1, s2.p2],
      }
    : {
        start: [s2.p1, s2.p2],
        end: [s1.p1, s1.p2],
      };
}

export function getTakeOffPoints(
  features: FeatureCollection<LineString>
): FeatureCollection<Point> {
  const takeOffPoints: any[] = [];

  features.features.forEach((feature: any) => {
    const takeOffEdge = getTakeOffEdge(feature);
    if (!takeOffEdge) return;

    const bearing1 = turf.rhumbBearing(
      turf.point(takeOffEdge.start[0]),
      turf.point(takeOffEdge.start[1])
    );
    const bearing2 = turf.rhumbBearing(
      turf.point(takeOffEdge.end[0]),
      turf.point(takeOffEdge.end[1])
    );

    const angle = Math.abs(bearing1 - bearing2) % 180;
    const tolerance = 3;
    feature.properties.straight = angle < tolerance || angle > 180 - tolerance;

    const takeOffStart = turf.midpoint(
      turf.point(takeOffEdge.start[0]),
      turf.point(takeOffEdge.start[1])
    ).geometry.coordinates;
    const takeOffEnd = turf.midpoint(
      turf.point(takeOffEdge.end[0]),
      turf.point(takeOffEdge.end[1])
    ).geometry.coordinates;

    takeOffPoints.push(
      ...[
        {
          type: "Feature",
          properties: {
            icao: feature.properties!.icao,
            envelopeId: feature.properties.id,
            type: "takeOffStart",
            "marker-color": "#0000FF",
            "marker-size": "medium",
            "marker-symbol": "star",
          },
          geometry: {
            type: "Point",
            coordinates: takeOffStart,
          },
        },
        {
          type: "Feature",
          properties: {
            icao: feature.properties!.icao,
            envelopeId: feature.properties.id,
            type: "takeOffEnd",
            "marker-color": "#FF00FF",
            "marker-size": "medium",
            "marker-symbol": "star",
          },
          geometry: {
            type: "Point",
            coordinates: takeOffEnd,
          },
        },
        // {
        //   type: "Feature",
        //   properties: {
        //     "marker-color": "#00FFFF",
        //   },
        //   geometry: {
        //     type: "LineString",
        //     coordinates: takeOffEdge.start,
        //   },
        // },
        // {
        //   type: "Feature",
        //   properties: {
        //     "marker-color": "#FFFFFF",
        //   },
        //   geometry: {
        //     type: "LineString",
        //     coordinates: takeOffEdge.end,
        //   },
        // },
      ]
    );
  });

  return {
    type: "FeatureCollection",
    features: takeOffPoints,
  };
}

export function getCurvePoints(
  feature: Feature<LineString>
): FeatureCollection<Point> {
  const { curveStart, curveEnd } = detectCurveTransitions(
    feature.geometry.coordinates
  );
  const points: Feature<Point>[] = [
    {
      type: "Feature",
      properties: {
        "marker-color": "#00FF00",
        "marker-size": "small",
        envelopeId: feature.properties!.envelopeId,
        icao: feature.properties!.icao,
        type: "curveStart",
      },
      geometry: {
        type: "Point",
        coordinates: feature.geometry.coordinates[curveStart],
      },
    },
    {
      type: "Feature",
      properties: {
        "marker-color": "#00FF00",
        "marker-size": "small",
        envelopeId: feature.properties!.envelopeId,
        icao: feature.properties!.icao,
        type: "curveEnd",
      },
      geometry: {
        type: "Point",
        coordinates: feature.geometry.coordinates[curveEnd],
      },
    },
  ];
  return {
    type: "FeatureCollection",
    features: points,
  };
}