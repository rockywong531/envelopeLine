import toGeoJSON from "@mapbox/togeojson";
import fs from "fs";
import { DOMParser } from "@xmldom/xmldom";
import * as turf from "@turf/turf";
import {
  LineString,
  FeatureCollection,
  Feature,
  Point,
  MultiLineString,
} from "geojson";

import {
  assignIcao,
  getTakeOffPoints,
  getEnvelopeByIcaos,
} from "./envelopeProcess";
import { getCentral } from "./skeleton";
import { getCurvePoints } from "./curve";
import { extendMedialToRunway, getRunwayEnds } from "./runwayProcess";
import { writeKmlFromFeatures } from "./geoJsonToKml";

// Function to convert KML file to GeoJSON
function convertKMLToGeoJSON(
  kmlFilePath: string,
  geoJsonFilePath: string,
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

function writeFeaturesToFile(features: Feature<any>[], byIcao?: boolean): void {
  const uniqueIcaos = [...new Set(features.map((f) => f.properties!.icao))];
  uniqueIcaos.forEach((icao) => {
    const featuresByIcao = features.filter((f) => f.properties!.icao === icao);
    const uniqueType = [
      ...new Set(featuresByIcao.map((f) => f.properties!.type)),
    ];
    uniqueType.forEach((type) => {
      const featuresByIcaoType = featuresByIcao.filter(
        (f) => f.properties!.type === type,
      );
      const uniqueEnvelopeIds = [
        ...new Set(featuresByIcaoType.map((f) => f.properties!.envelopeId)),
      ];

      const envelopes = featureCol.features.filter((f) => {
        if (!byIcao) return uniqueEnvelopeIds.includes(f.properties!.id);
        return f.properties!.icao === icao;
      });

      const featureObj: FeatureCollection<any> = {
        type: "FeatureCollection",
        features: [...envelopes, ...featuresByIcaoType],
      };

      fs.writeFileSync(
        `results/skeletons/${type}_${icao}.json`,
        JSON.stringify(featureObj, null, 2),
      );
    });
  });
}

// const icao = "RJSM";
// const icao = "RJCJ";
// const icao = "RJAA";
// const icao = "RJCC";
// const icao = "RJOO";
// const icao = "RJTT";
// const icao = "RJOA";
// const icao = "RJCB";
// const icao = "RJOT";
// const icao = "RJOA";
const icaos: string[] = [
  // "RJOO",
  // "RJTT",
  // "RJOA",
  // "RJOB",
  // "RJBE",
  // "RJSS",
  // "RJCH",
  // "RJEC",
  // "RJOT",
  "RJFF"
];

const geoData = convertKMLToGeoJSON(
  "resources/obstacle_airdo.kml",
  "results/geo.json",
);

let featureCol = assignIcao(geoData) as FeatureCollection<LineString>;
fs.writeFileSync(
  `results/geo_flatten.json`,
  JSON.stringify(featureCol, null, 2),
);

featureCol.features.forEach((feature: any) => {
  if (feature.geometry.type !== "LineString") {
    console.log("Non-LineString feature found:", feature.geometry.type);
  }
});

featureCol = getEnvelopeByIcaos(featureCol, icaos);
// featureCol = turf.featureCollection(featureCol.features);
// fs.writeFileSync(
//   `results/${icao}_envelopes.json`,
//   JSON.stringify(featureCol, null, 2)
// );

let takeOffPoints = getTakeOffPoints(
  featureCol as FeatureCollection<LineString>,
);

const envelopesTakeOffs = {
  type: "FeatureCollection",
  features: [...featureCol.features, ...takeOffPoints.features],
};
fs.writeFileSync(
  `results/envelopeTakeOffs.json`,
  JSON.stringify(envelopesTakeOffs, null, 2),
);

let centralLines: Feature<LineString>[] = [];
let curvePoints: Feature<Point>[] = [];
let centralSkeletons: Feature<MultiLineString>[] = [];
let centralMultiLines: Feature<MultiLineString>[] = [];

fs.mkdirSync("results/airdo", { recursive: true });
fs.mkdirSync("results/skeletons", { recursive: true });

featureCol.features.forEach((envelope: Feature<LineString>) => {
  const icao = envelope.properties!.icao;
  const rwy = envelope.properties!.rwy;
  const envelopeId = envelope.properties!.id;
  const takeOffStart = takeOffPoints.features.find(
    (pt) =>
      pt.properties!.envelopeId === envelopeId &&
      pt.properties!.type == "takeOffStart",
  )!;
  const takeOffEnd = takeOffPoints.features.find(
    (pt) =>
      pt.properties!.envelopeId === envelopeId &&
      pt.properties!.type == "takeOffEnd",
  )!;

  if (envelope.properties!.straight!) {
    console.log(
      `${icao} RWY ${envelope.properties!.rwy} id: ${envelopeId} - straight`,
    );
    const centralLine: Feature<LineString> = {
      type: "Feature",
      properties: {
        icao,
        envelopeId,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          takeOffStart.geometry.coordinates,
          takeOffEnd.geometry.coordinates,
        ],
      },
    };
    extendMedialToRunway(centralLine);
    centralLines.push(centralLine);

    writeKmlFromFeatures(
      `results/airdo/straight_${icao}_${rwy}.kml`,
      envelope,
      centralLine,
    );
    return;
  }

  console.log(
    `${icao} RWY ${envelope.properties!.rwy} id: ${envelopeId} - curved`,
  );
  const { centralLine, centralMultiLine, centralSkeleton } = getCentral(
    envelope,
    takeOffStart.geometry.coordinates,
    takeOffEnd.geometry.coordinates,
  );

  centralSkeletons.push(centralSkeleton);
  centralMultiLines.push(centralMultiLine);
  centralLines.push(centralLine);

  const turns = getCurvePoints(centralLine, envelope, takeOffStart, takeOffEnd);
  curvePoints.push(...turns);

  extendMedialToRunway(centralLine);

  const distTurn1 = turns.find((t) => t.properties!.type === "distTurn1");
  const distTurn2 = turns.find((t) => t.properties!.type === "distTurn2");
  writeKmlFromFeatures(
    `results/airdo/curved_${icao}_${rwy}.kml`,
    envelope,
    centralLine,
    distTurn1,
    distTurn2,
  );
});

if (icaos.length > 0) {
  writeFeaturesToFile(centralSkeletons, true);
  writeFeaturesToFile(centralMultiLines, true);
}

const featureIcaos = featureCol.features.map((f) => f.properties!.icao);
const uniqueIcaos = [...new Set(featureIcaos)];
const runwayEnds: Feature<Point>[] = [];

uniqueIcaos.forEach((icao) => {
  runwayEnds.push(...getRunwayEnds(icao));
});

// const displayIndex = 0;
// const envelopeIds: string[] = [];
// uniqueIcaos.forEach((icao) => {
//   const envelopes = featureCol.features.filter(
//     (f) => f.properties!.icao === icao
//   );
//   if (displayIndex >= envelopes.length) return;
//   envelopeIds.push(envelopes[displayIndex].properties!.id);
// });

// featureCol.features = featureCol.features.filter((f) =>
//   envelopeIds.includes(f.properties!.id)
// );
// takeOffPoints.features = takeOffPoints.features.filter((f) =>
//   envelopeIds.includes(f.properties!.envelopeId)
// );
// medialPaths = medialPaths.filter((f) =>
//   envelopeIds.includes(f.properties!.envelopeId)
// );
// curvePoints = curvePoints.filter((f) =>
//   envelopeIds.includes(f.properties!.envelopeId)
// );

const envelopesMedials = {
  type: "FeatureCollection",
  features: [
    ...featureCol.features,
    // ...takeOffPoints.features,
    ...centralLines,
    ...curvePoints,
    // ...runwayEnds,
  ],
};
fs.writeFileSync(
  `results/envelopeMedials.json`,
  JSON.stringify(envelopesMedials, null, 2),
);
