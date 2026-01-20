import Papa from "papaparse";
import { Feature, LineString, Point, Position } from "geojson";
import fs from "fs";
import * as turf from "@turf/turf";
import { get } from "http";

export function extendMedialToRunway(feature: Feature<LineString>) {
  const runways = getRunways();
  interface PendingRwy {
    rwyCoord: Position;
    rwyLength: number;
    bearingDiff: number;
  }

  const icao = feature.properties!.icao;
  const rwys = runways.filter((rwy) => rwy.Code === icao);
  if (rwys.length === 0) return;

  const envStart = feature.geometry.coordinates[0];
  const envBearing = turf.bearing(
    turf.point(feature.geometry.coordinates[1]),
    turf.point(envStart),
  );

  let pendingRwys = rwys.map((rwy) => {
    const lat = parseDMSToDec(rwy.LatStartTORA);
    const lon = parseDMSToDec(rwy.LongStartTORA);
    const rwyStart = turf.point([lon, lat]);
    const rwyBearing = turf.bearing(envStart, rwyStart);
    let diff = Math.abs(envBearing - rwyBearing);
    if (diff > 180) {
      diff = 360 - diff;
    }
    const rwyLength = turf.distance(envStart, rwyStart);

    return {
      rwyCoord: rwyStart.geometry.coordinates,
      rwyLength,
      bearingDiff: diff,
    } as PendingRwy;
  });

  pendingRwys = pendingRwys.sort((a, b) => {
    const bearingDiff = a.bearingDiff - b.bearingDiff;
    if (bearingDiff !== 0) {
      return bearingDiff;
    }
    return b.rwyLength - a.rwyLength;
  });

  feature.geometry.coordinates.unshift(
    pendingRwys[0].rwyCoord,
  );
}

function parseDMSToDec(dmsStr: string): number {
  // Regex to capture: Degrees (2-3 digits), Minutes (2 digits), Seconds (remaining digits/decimal)
  // and the Direction (N, S, E, W)
  const regex = /^(\d{2,3})(\d{2})(\d{2}\.?\d*)([NSEW])$/;
  const match = dmsStr.match(regex);

  if (!match) {
    throw new Error("Invalid coordinate format");
  }

  const degrees = parseFloat(match[1]);
  const minutes = parseFloat(match[2]);
  const seconds = parseFloat(match[3]);
  const direction = match[4];

  let decimal = degrees + minutes / 60 + seconds / 3600;

  // If South or West, the decimal value must be negative
  if (direction === "S" || direction === "W") {
    decimal = decimal * -1;
  }

  return parseFloat(decimal.toFixed(6)); // Standard 6 decimal places
}

function getRunways(): any[] {
  const csvData = fs.readFileSync("./resources/RwyInfo.csv", "utf-8");
  const results = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  }).data as any[];

  return results;
}

export function getRunwayEnds(icao: string): Feature<Point>[] {
  const runways = getRunways();
  const rwys = runways.filter((rwy) => rwy.Code === icao);
  const points: Feature<Point>[] = [];

  rwys.forEach((rwy) => {
    const lat = parseDMSToDec(rwy.LatStartTORA);
    const lon = parseDMSToDec(rwy.LongStartTORA);
    const point: Feature<Point> = {
      type: "Feature",
      properties: {
        icao,
        "marker-color": "#FFAFA0",
        "marker-size": "small",
      },
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
    };
    points.push(point);
  });

  return points;
}
