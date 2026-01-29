# KML Runway & Obstacle Processor

A Node.js and TypeScript utility designed to parse KML files containing spatial envelopes, identify airport and runway features, and generate enriched GeoJSON and XML/KML outputs. This tool automates the detection of runway geometry, including central line calculation and turning point generation for curved paths.

---

## 🚀 Features

* **KML to GeoJSON Conversion:** Transforms source KML data into structured GeoJSON.
* **Feature Detection:** Automatically identifies **Airports** and **Runways** using GPS coordinates and feature property naming conventions.
* **Geometry Enhancement:**
    * Detects the specific shape of the envelope.
    * Calculates and adds a **Central Line**.
    * Generates **Turning Points** specifically for curved envelopes to maintain spatial accuracy.
* **Dual-Format Export:** Generates individual files for every envelope in both GeoJSON and XML/KML formats.

---

## 🛠 Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd <project-folder>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

---

## 🚦 Usage

### 1. Configure Source File
By default, the script processes `resources/obstacle_airdo.kml`. To change the source or destination of the main conversion, edit the function call in your main entry file:

```typescript
const geoData = convertKMLToGeoJSON(
  "resources/obstacle_airdo.kml", // Input source file
  "results/geo.json",             // Main GeoJSON output
);