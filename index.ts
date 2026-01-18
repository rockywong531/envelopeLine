import toGeoJSON from "@mapbox/togeojson";
import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import * as turf from "@turf/turf";
import { LineString, FeatureCollection, Feature, Point } from "geojson";

import {
  assignIcao,
  getTakeOffPoints,
  getEnvelopeByIcao,
  getCurvePoints,
} from "./envelopeProcess";
import { createVoronoi, getEdgesInEnvelope, getMedialPath } from "./voronoi";
import { getCentral } from "./skeleton";

// Function to convert KML file to GeoJSON
function convertKMLToGeoJSON(
  kmlFilePath: string,
  geoJsonFilePath: string
): any {
  // Read the KML file
  const kmlData = fs.readFileSync(kmlFilePath, "utf-8");

  // Parse the KML data into a DOM
  const kmlDom = new DOMParser().parseFromString(kmlData, "text/xml");

  // Convert the KML DOM to GeoJSON
  const geoData = toGeoJSON.kml(kmlDom);

  // Write the GeoJSON data to a file
  fs.writeFileSync(geoJsonFilePath, JSON.stringify(geoData, null, 2));

  return geoData;
}

function writeFeaturesToFile(features: any[], filePath: string): void {
  const featureObj = {
    type: "FeatureCollection",
    features: features,
  };
  fs.writeFileSync(filePath, JSON.stringify(featureObj, null, 2));
}

// const icao = "RJBE";
// const icao = "RJCH";
// const icao = "RJAA";
// const icao = "RJCC";
// const icao = "RJOO";
// const icao = "RJTT";
// const icao = "RJOA";
// const icao = "RJCB";
// const icao = "RJOT";
const geoData = convertKMLToGeoJSON(
  "resources/obstacle_airdo.kml",
  "results/geo.json"
);

let featureCol = assignIcao(geoData) as FeatureCollection<LineString>;
fs.writeFileSync(
  `results/geo_flatten.json`,
  JSON.stringify(featureCol, null, 2)
);

featureCol.features.forEach((feature: any) => {
  if (feature.geometry.type !== "LineString") {
    console.log("Non-LineString feature found:", feature.geometry.type);
  }
});

// featureCol = getEnvelopeByIcao(featureCol, icao);
// featureCol = turf.featureCollection([featureCol.features[1]]);
// featureCol.features[0].geometry.coordinates =
//   featureCol.features[0].geometry.coordinates.reverse();

// fs.writeFileSync(
//   `results/${icao}_envelopes.json`,
//   JSON.stringify(featureCol, null, 2)
// );

// const centraline = getCentraline(featureCol.features[0]);
// fs.writeFileSync(
//   `results/${icao}_centraline.json`,
//   JSON.stringify(centraline, null, 2)
// );

const takeOffPoints = getTakeOffPoints(
  featureCol as FeatureCollection<LineString>
);

const envelopesTakeOffs = {
  type: "FeatureCollection",
  features: [...featureCol.features, ...takeOffPoints.features],
};
fs.writeFileSync(
  `results/envelopeTakeOffs.json`,
  JSON.stringify(envelopesTakeOffs, null, 2)
);

const medialPaths: Feature<LineString>[] = [];
const curvePoints: Feature<Point>[] = [];

featureCol.features.forEach((feature: Feature<LineString>, i: number) => {
  const icao = feature.properties!.icao;
  const envelopeId = feature.properties!.id;
  const takeOffStart = takeOffPoints.features.find(
    (pt) =>
      pt.properties!.envelopeId === envelopeId &&
      pt.properties!.type == "takeOffStart"
  )!;
  const takeOffEnd = takeOffPoints.features.find(
    (pt) =>
      pt.properties!.envelopeId === envelopeId &&
      pt.properties!.type == "takeOffEnd"
  )!;

  if (feature.properties!.straight!) {
    console.log(`${icao} id: ${envelopeId} - straight`);
    const medialPath = turf.lineString([
      takeOffStart.geometry.coordinates,
      takeOffEnd.geometry.coordinates,
    ]);
    medialPaths.push(medialPath);
    return;
  }

  console.log(`${icao} id: ${envelopeId} - curved`);
  const {centralLine, centralMultiLine, centralSkeleton} = getCentral(
    feature,
    takeOffStart.geometry.coordinates,
    takeOffEnd.geometry.coordinates
  );

  centralLine.properties = {
    ...centralLine.properties,
    icao,
    envelopeId,
  };

  medialPaths.push(centralLine);

  // const { voronoi, envelope } = createVoronoi(feature.geometry.coordinates);
  // const edgesInEnvelope = getEdgesInEnvelope(voronoi, envelope);

  // const { medialPath } = getMedialPath(
  //   edgesInEnvelope,
  //   takeOffStart.geometry.coordinates,
  //   takeOffEnd.geometry.coordinates,
  //   envelope
  // );

  // const error = turf.distance(
  //   takeOffEnd,
  //   medialPath.geometry.coordinates[medialPath.geometry.coordinates.length - 1],
  //   { units: "meters" }
  // );
  // if (error > 500) {
  //   console.log(`${icao} id: ${envelopeId} - error: ${error}`);
  // }

  // medialPath.properties = {
  //   ...medialPath.properties,
  //   icao,
  //   envelopeId,
  // };
  // medialPaths.push(medialPath);

  // const cps = getCurvePoints(medialPath);
  // curvePoints.push(...cps.features);
});

const envelopesMedials = {
  type: "FeatureCollection",
  features: [
    ...featureCol.features,
    ...takeOffPoints.features,
    ...medialPaths,
    ...curvePoints,
  ],
};
fs.writeFileSync(
  `results/envelopeMedials.json`,
  JSON.stringify(envelopesMedials, null, 2)
);
