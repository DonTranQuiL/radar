import { useMemo } from "react";
import { partyFill, partyShort } from "@/lib/parties";

type Ring = number[][];
type Geometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

export type GemeenteFeature = {
  type: "Feature";
  properties: { code: string; name: string };
  geometry: Geometry;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const VIEW_W = 640;
const VIEW_H = 760;

function project(lon: number, lat: number, bounds: Bounds) {
  const x = ((lon - bounds.minX) / (bounds.maxX - bounds.minX)) * VIEW_W;
  const y = ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * VIEW_H;
  return [x, y] as const;
}

function ringPath(ring: Ring, bounds: Bounds) {
  return (
    ring
      .map((point, index) => {
        const [x, y] = project(point[0], point[1], bounds);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join("") + "Z"
  );
}

function geometryPath(geometry: Geometry, bounds: Bounds) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => ringPath(ring, bounds)).join("");
  }
  return geometry.coordinates
    .map((polygon) => polygon.map((ring) => ringPath(ring, bounds)).join(""))
    .join("");
}

function boundsOf(features: GemeenteFeature[], tight: boolean): Bounds {
  let minX = tight ? Number.POSITIVE_INFINITY : 3.2;
  let maxX = tight ? Number.NEGATIVE_INFINITY : 7.3;
  let minY = tight ? Number.POSITIVE_INFINITY : 50.7;
  let maxY = tight ? Number.NEGATIVE_INFINITY : 53.6;
  for (const feature of features) {
    const polys =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const polygon of polys) {
      for (const point of polygon[0] ?? []) {
        if (point[0] < 3 || point[0] > 8 || point[1] < 50.5 || point[1] > 54) continue;
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 3.2, maxX: 7.3, minY: 50.7, maxY: 53.6 };
  }
  const padX = (maxX - minX) * 0.04 || 0.02;
  const padY = (maxY - minY) * 0.04 || 0.02;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

function heatClass(value: number | null | undefined, breaks: number[]) {
  if (value == null) return "fill-heat-0";
  if (value >= breaks[3]) return "fill-heat-4";
  if (value >= breaks[2]) return "fill-heat-3";
  if (value >= breaks[1]) return "fill-heat-2";
  if (value >= breaks[0]) return "fill-heat-1";
  return "fill-heat-0";
}

export function NlMap({
  features,
  values,
  selected,
  onSelect,
  tight = false,
  parties,
}: {
  features: GemeenteFeature[];
  values: Map<string, number | null>;
  selected: string | null;
  onSelect: (code: string) => void;
  tight?: boolean;
  parties?: Map<string, string>;
}) {
  const bounds = useMemo(() => boundsOf(features, tight), [features, tight]);
  const paths = useMemo(
    () =>
      features.map((feature) => ({
        code: feature.properties.code,
        name: feature.properties.name,
        d: geometryPath(feature.geometry, bounds),
      })),
    [features, bounds],
  );
  const breaks = useMemo(() => {
    const sorted = [...values.values()].filter((value): value is number => value != null).sort((a, b) => a - b);
    if (sorted.length === 0) return [1, 2, 3, 4];
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? 0;
    return [at(0.2), at(0.45), at(0.7), at(0.88)];
  }, [values]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      role="img"
      aria-label="Map of Dutch municipalities colored by registered incidents"
    >
      <rect width={VIEW_W} height={VIEW_H} className="fill-bg" />
      {paths.map((path) => {
        const party = parties?.get(path.code);
        const active = path.code === selected;
        const title = party
          ? `${path.name}: ${partyShort(party)}`
          : `${path.name}${values.has(path.code) ? `: ${values.get(path.code) ?? "suppressed"}` : ""}`;
        return (
          <path
            key={path.code}
            d={path.d}
            className={`${party ? "" : heatClass(values.get(path.code), breaks)} ${
              active ? "stroke-primary" : "stroke-coast"
            } transition-opacity duration-150 hover:opacity-80`}
            style={party ? { fill: partyFill(party) } : undefined}
            strokeWidth={active ? 3 : tight ? 2.2 : 1.1}
            onClick={() => onSelect(path.code)}
          >
            <title>{title}</title>
          </path>
        );
      })}
    </svg>
  );
}
