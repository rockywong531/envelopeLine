import * as turf from "@turf/turf";
import {
  Feature,
  LineString,
  Position,
  Polygon,
  FeatureCollection,
  MultiPolygon,
  Point,
  GeometryCollection,
  Geometry,
} from "geojson";
import Papa from "papaparse";
import fs from "fs";
import { nanoid } from "nanoid";
import * as toGeoJSON from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";

import { multiLineToLine, simplifyClosedLine } from "./utils";

// Function to convert KML file to GeoJSON
export function convertKMLToGeoJSON(
  kmlFilePath: string,
  geoJsonFilePath: string,
): any {
  const kmlData = fs.readFileSync(kmlFilePath, "utf-8");
  let kmlDom = new DOMParser().parseFromString(kmlData, "text/xml");
  kmlDom = splitNestedMultiGeometry(kmlDom);
  const geoData = toGeoJSON.kml(kmlDom);
  fs.writeFileSync(geoJsonFilePath, JSON.stringify(geoData, null, 2));
  return geoData;
}

function splitNestedMultiGeometry(doc: Document): Document {
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));

  for (const placemark of placemarks) {
    const rootMg = placemark.getElementsByTagName("MultiGeometry")[0];
    if (!rootMg) continue;

    const nestedMgs = Array.from(rootMg.childNodes).filter(
      (n): n is Element => n.nodeType === 1 && n.nodeName === "MultiGeometry"
    );

    if (nestedMgs.length <= 1) continue;

    nestedMgs.forEach((nestedMg, index) => {
      const newPlacemark = placemark.cloneNode(true) as Element;
      const newRootMg = newPlacemark.getElementsByTagName("MultiGeometry")[0];

      // Clear the root MultiGeometry and add only this nested one's children
      while (newRootMg.firstChild) newRootMg.removeChild(newRootMg.firstChild);
      Array.from(nestedMg.childNodes).forEach((child) =>
        newRootMg.appendChild(child.cloneNode(true))
      );

      const extendedData = doc.createElement("ExtendedData");
      const data = doc.createElement("Data");
      data.setAttribute("name", "seq");
      const value = doc.createElement("value");
      value.textContent = String(index + 1);
      data.appendChild(value);
      extendedData.appendChild(data);
      newPlacemark.appendChild(extendedData);

      placemark.parentNode!.insertBefore(newPlacemark, placemark);
    });

    placemark.parentNode!.removeChild(placemark);
  }

  return doc;
}

export function assignIcao(col: FeatureCollection): FeatureCollection {
  const file = fs.readFileSync("resources/airports.csv", "utf-8");
  let apInfo = Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
  }).data as any[];

  apInfo = apInfo.filter(
    (ap) =>
      ap.iso_country === "JP" &&
      ap.ident.startsWith("RJ") &&
      ap.type.endsWith("airport"),
  );

  // RJFF GeometryCollection
  const replaceCol: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: [],
  };
  col.features!.forEach((feature) => {
    if (
      feature.geometry.type !== "GeometryCollection" 
      // || feature.geometry.geometries.length <= 2
    ) {
      replaceCol.features.push(feature as Feature<LineString>);
      return;
    }

    console.log(feature);
    console.log(feature.geometry.geometries)

    // multiple envelope in the same GeometryCollection
    const geoCol = feature as Feature<GeometryCollection<LineString>>;
    if (geoCol.geometry.geometries.length <= 2) {
      const lineCoords: Position[][] = [];

      geoCol.geometry.geometries.forEach((g) => {
        if (g.type !== "LineString" && g.coordinates.length <= 2) return;
        lineCoords.push(g.coordinates);
      });

      const envelopes = lineCoords.map((coords, i) => {
        const lineString: Feature<LineString> = {
          type: "Feature",
          properties: {
            ...geoCol.properties,
            seq: i + 1,
          },
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
        };

        console.log(lineString);

        return lineString;
      });

      replaceCol.features.push(...envelopes);
      return;
    }

    // many lineString with 2 elements
    const segments: Position[][] = geoCol.geometry.geometries.map((g) => {
      return [
        g.coordinates[0].slice(0, 2),
        g.coordinates[g.coordinates.length - 1].slice(0, 2),
      ];
    });

    const orderedPath = multiLineToLine(segments);
    let envFeature: Feature<LineString> = {
      type: "Feature",
      properties: {
        ...geoCol.properties,
      },
      geometry: {
        type: "LineString",
        coordinates: orderedPath,
      },
    };
    envFeature = simplifyClosedLine(envFeature);
    replaceCol.features.push(envFeature);
  });

  fs.writeFileSync(
    `results/geo_replaced.json`,
    JSON.stringify(replaceCol, null, 2),
  );

  let flattened = turf.flatten(replaceCol);
  const cleaned = flattened.features.map((f) => {
    return turf.cleanCoords(f);
  });
  flattened = turf.featureCollection(cleaned);

  flattened.features.forEach((f) => {
    if (f.geometry.coordinates.length > 4) return;
    console.log(JSON.stringify(f, null, 2));
  });

  flattened.features = flattened.features.filter(
    (f) => f.geometry.coordinates.length >= 4,
  );

  const rwyFeatures: Feature<LineString>[] = [];
  flattened.features.forEach((feature) => {
    const polygon = turf.lineToPolygon(feature);
    const centre = turf.center(polygon).geometry.coordinates;

    let dist = Infinity;
    let nearestIcao = "";
    let nearestName = "";
    let byName = false;

    // ICAO from properties name
    const apIcaoReg = /(RJ[A-Z]{2})/;
    const icaoMatch = feature.properties!.name.match(apIcaoReg);
    if (icaoMatch) {
      const icao = icaoMatch[1];
      const ap = apInfo.find((ap) => ap.ident === icao);
      if (ap) {
        const distance = turf.distance(
          turf.point(centre),
          turf.point([
            parseFloat(ap.longitude_deg),
            parseFloat(ap.latitude_deg),
          ]),
          { units: "kilometers" },
        );
        if (distance < 10) {
          dist = distance;
          nearestIcao = icao;
          nearestName = ap.name;
          byName = true;
        }
      }
    }

    // Get ICAO by distance
    if (!nearestIcao) {
      for (const ap of apInfo) {
        const distance = turf.distance(
          turf.point(centre),
          turf.point([
            parseFloat(ap.longitude_deg),
            parseFloat(ap.latitude_deg),
          ]),
          { units: "kilometers" },
        );

        if (distance < dist) {
          dist = distance;
          nearestIcao = ap.ident;
          nearestName = ap.name;
        }
      }
    }

    feature.properties = {
      ...feature.properties,
      icao: nearestIcao,
      airportName: nearestName,
    };

    // Runway from properties name
    // RJOT 08
    // RJFF RWY16L/34R
    const rwyReg = /(?:RJ[A-Z]{2})? ?(?:RWY)?(\d{2}[LRC]?(?:\/\d{2}[LRC]?)*)/;
    const rwyMatch = feature.properties!.name.match(rwyReg);
    const rwyCodes: string[] = rwyMatch[1].split("/");
    rwyCodes.forEach((rwy) => {
      const cloned = structuredClone(feature);
      cloned.properties = {
        ...cloned.properties,
        rwy,
        id: nanoid(),
      };
      rwyFeatures.push(cloned);
    });

    console.log(
      `Assigned ICAO ${nearestIcao} RWY ${rwyCodes} to feature at ${centre} (distance: ${dist.toFixed(
        2,
      )} km) (${byName ? "by name" : "by distance"})`,
    );
  });

  const uniqueFeatures: Feature<LineString>[] = [];
  for (const feature of rwyFeatures) {
    const duplicated = uniqueFeatures.some((uf) => {
      if (
        feature.properties!.icao !== uf.properties!.icao ||
        feature.properties!.rwy !== uf.properties!.rwy
      ) {
        return false;
      }

      const similarity = getEnvelopeSimilarity(
        uf as Feature<LineString>,
        feature as Feature<LineString>,
      );
      return similarity >= 0.95;
    });

    if (!duplicated) {
      uniqueFeatures.push(feature);
    }
  }

  return turf.featureCollection(uniqueFeatures);
}

export function getEnvelopeByIcaos(
  geoData: FeatureCollection<LineString>,
  icaos: string[],
): FeatureCollection<LineString> {
  const features = geoData.features.filter((feature: any) => {
    if (feature.geometry?.type !== "LineString") return false;
    if (icaos.length === 0) return true;
    return icaos.includes(feature.properties!.icao);
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
  env2: Feature<LineString>,
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
  features: FeatureCollection<LineString>,
): FeatureCollection<Point> {
  const takeOffPoints: any[] = [];

  features.features.forEach((feature: any) => {
    const takeOffEdge = getTakeOffEdge(feature);
    if (!takeOffEdge) return;

    const bearing1 = turf.rhumbBearing(
      turf.point(takeOffEdge.start[0]),
      turf.point(takeOffEdge.start[1]),
    );
    const bearing2 = turf.rhumbBearing(
      turf.point(takeOffEdge.end[0]),
      turf.point(takeOffEdge.end[1]),
    );

    const angle = Math.abs(bearing1 - bearing2) % 180;
    const tolerance = 3;
    feature.properties.straight = angle < tolerance || angle > 180 - tolerance;

    const takeOffStart = turf.midpoint(
      turf.point(takeOffEdge.start[0]),
      turf.point(takeOffEdge.start[1]),
    ).geometry.coordinates;
    const takeOffEnd = turf.midpoint(
      turf.point(takeOffEdge.end[0]),
      turf.point(takeOffEdge.end[1]),
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
      ],
    );
  });

  return {
    type: "FeatureCollection",
    features: takeOffPoints,
  };
}
