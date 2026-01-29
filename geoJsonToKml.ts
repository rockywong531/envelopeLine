import * as turf from "@turf/turf";
import {
  Feature,
  Point,
  Polygon,
  LineString,
  FeatureCollection,
} from "geojson";
const tokml = require("tokml"); // import does not work for old lib
import format from "xml-formatter";
import fs from "fs";
import path from "path";

export function writeKmlFromFeatures(
  filePath: string,
  envelope: Feature<LineString>,
  centralLine: Feature<LineString>,
  turn1?: Feature<Point>,
  turn2?: Feature<Point>,
): string {
  const polygon = turf.lineToPolygon(envelope) as Feature<Polygon>;
  const collection = turf.featureCollection(
    [polygon, centralLine, turn1, turn2].filter(Boolean) as Feature<any>[],
  );

  const dir = path.dirname(filePath) + "/json";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = path.basename(filePath);
  fs.writeFileSync(
    path.join(dir, filename.replace(".kml", ".json")),
    JSON.stringify(collection, null, 2),
  );

  const output = format(tokml(collection), {
    indentation: "  ",
    collapseContent: true,
    lineSeparator: "\n",
  });
  fs.writeFileSync(filePath, output);

  return output;
}
