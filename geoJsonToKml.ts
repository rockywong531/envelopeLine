import * as turf from "@turf/turf";
import {
  Feature,
  Point,
  Polygon,
  LineString,
  FeatureCollection,
} from "geojson";
const tokml = require("tokml");   // import does not work for old lib

export function getKmlFromFeatures(
  envelope: Feature<LineString>,
  centralLine: Feature<LineString>,
  turn1?: Feature<Point>,
  turn2?: Feature<Point>,
): string {
  const polygon = turf.lineToPolygon(envelope) as Feature<Polygon>;
  const collection = turf.featureCollection([
    polygon,
    centralLine,
    turn1,
    turn2,
  ].filter(Boolean) as Feature<any>[]);

  return tokml(collection);
}
