const POLICE = "https://dataderden.cbs.nl/ODataApi/OData";
const CBS = "https://opendata.cbs.nl/ODataApi/OData";

export const DATASETS = {
  crimes: {
    id: "47013NED",
    label: "Registered crimes",
    topic: "SoortMisdrijf",
    geo: "RegioS",
    measure: "GeregistreerdeMisdrijven_1",
    local: "47022NED",
  },
  nuisance: {
    id: "47021NED",
    label: "Registered nuisance",
    topic: "Overlast",
    geo: "RegioS",
    measure: "GeregistreerdeOverlast_1",
    local: "47024NED",
  },
} as const;

export type DatasetId = keyof typeof DATASETS;

type CodeRow = { Key: string; Title: string };
type ValueRow = Record<string, string | number | null>;

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function odata(
  table: string,
  entity: string,
  params?: Record<string, string>,
  host = POLICE,
) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  let url: string | undefined = `${host}/${table}/${entity}${query}`;
  const rows: ValueRow[] = [];
  while (url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      throw new Error(`Police data feed refused the query (${response.status}).`);
    }
    const payload = (await response.json()) as {
      value?: ValueRow[];
      "odata.nextLink"?: string;
    };
    rows.push(...(payload.value ?? []));
    url = payload["odata.nextLink"];
    if (rows.length > 8000) break;
  }
  return rows;
}

function specOf(dataset: DatasetId) {
  return DATASETS[dataset];
}

export async function loadMeta() {
  const spec = specOf("crimes");
  const rows = (await odata(spec.id, "Perioden", { $select: "Key,Title" })) as CodeRow[];
  const months = rows.filter((row) => row.Key.includes("MM"));
  const latest = [...months].sort((a, b) => a.Key.localeCompare(b.Key)).at(-1);
  if (!latest) throw new Error("No monthly periods published.");
  return {
    latest: { key: latest.Key, title: latest.Title },
    periods: [...months]
      .sort((a, b) => b.Key.localeCompare(a.Key))
      .slice(0, 18)
      .map((row) => ({ key: row.Key, title: row.Title })),
  };
}

async function totalKey(table: string, topic: string) {
  const rows = (await odata(table, topic, {
    $select: "Key,Title",
    $filter: "substringof('otaal',Title)",
  })) as CodeRow[];
  const total = rows.find((row) => row.Title.toLowerCase().startsWith("totaal")) ?? rows[0];
  if (!total) throw new Error("Could not find the total category in this table.");
  return total.Key;
}

export async function loadOverview(dataset: DatasetId, period: string) {
  const spec = specOf(dataset);
  const key = await totalKey(spec.id, spec.topic);
  const rows = await odata(spec.id, "TypedDataSet", {
    $select: `${spec.geo},${spec.measure}`,
    $filter: `${spec.topic} eq ${quote(key)} and Perioden eq ${quote(period)}`,
  });
  return rows
    .map((row) => ({
      code: String(row[spec.geo] ?? "").trim(),
      value: asCount(row[spec.measure]),
    }))
    .filter((row) => row.code.startsWith("GM"));
}

export async function loadDetail(dataset: DatasetId, period: string, code: string) {
  const spec = specOf(dataset);
  const [list, rows] = await Promise.all([
    odata(spec.id, spec.topic, { $select: "Key,Title" }) as Promise<CodeRow[]>,
    odata(spec.id, "TypedDataSet", {
      $select: `${spec.topic},${spec.measure}`,
      $filter: `${spec.geo} eq ${quote(code)} and Perioden eq ${quote(period)}`,
    }),
  ]);
  const titles = Object.fromEntries(list.map((row) => [row.Key, row.Title]));
  return rows
    .map((row) => ({
      code: String(row[spec.topic] ?? "").trim(),
      label: titles[String(row[spec.topic] ?? "")] ?? String(row[spec.topic] ?? ""),
      value: asCount(row[spec.measure]),
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

const ORIGIN_GROUPS = [
  ["2012605", "Origin outside the Netherlands"],
  ["H008859", "Outside Europe"],
  ["H008673", "Morocco"],
  ["H008766", "Turkey"],
  ["H008751", "Suriname"],
  ["H007119", "Dutch Caribbean"],
  ["H008632", "Indonesia"],
  ["H008860", "Africa, excluding Morocco"],
  ["H008862", "Asia, excluding Indonesia and Turkey"],
] as const;

export async function loadBornAbroad() {
  const rows = await odata(
    "85458NED",
    "TypedDataSet",
    {
      $select: "RegioS,Geboorteland,Bevolking_1",
      $filter:
        "Geslacht eq 'T001038' and Leeftijd eq '10000' and Herkomstland eq 'T001040' and Perioden eq '2026JJ00' and (Geboorteland eq 'T001638' or Geboorteland eq 'A051736')",
    },
    CBS,
  );
  const total = new Map<string, number>();
  const abroad = new Map<string, number>();
  for (const row of rows) {
    const code = String(row.RegioS ?? "").trim();
    if (!code.startsWith("GM")) continue;
    const count = asCount(row.Bevolking_1);
    if (count == null) continue;
    if (String(row.Geboorteland).trim() === "A051736") abroad.set(code, count);
    if (String(row.Geboorteland).trim() === "T001638") total.set(code, count);
  }
  const shares: { code: string; value: number | null }[] = [];
  for (const [code, people] of total) {
    const born = abroad.get(code);
    shares.push({ code, value: born == null || people === 0 ? null : Math.round((1000 * born) / people) / 10 });
  }
  return shares;
}

export async function loadPlacePeople(code: string) {
  const rows = await odata(
    "85458NED",
    "TypedDataSet",
    {
      $select: "Geboorteland,Herkomstland,Bevolking_1",
      $filter: `Geslacht eq 'T001038' and Leeftijd eq '10000' and Perioden eq '2026JJ00' and RegioS eq ${quote(code)} and ((Herkomstland eq 'T001040' and (Geboorteland eq 'T001638' or Geboorteland eq 'A051736')) or (Geboorteland eq 'T001638' and (${ORIGIN_GROUPS.map(([key]) => `Herkomstland eq ${quote(key)}`).join(" or ")})))`,
    },
    CBS,
  );
  let population: number | null = null;
  let bornAbroad: number | null = null;
  const groups: { label: string; value: number | null }[] = [];
  const wanted = new Map<string, string>(ORIGIN_GROUPS);
  for (const row of rows) {
    const birth = String(row.Geboorteland ?? "").trim();
    const origin = String(row.Herkomstland ?? "").trim();
    const count = asCount(row.Bevolking_1);
    if (origin === "T001040" && birth === "T001638") population = count;
    if (origin === "T001040" && birth === "A051736") bornAbroad = count;
    const label = wanted.get(origin);
    if (label && birth === "T001638") groups.push({ label, value: count });
  }
  return { population, bornAbroad, groups };
}

export async function loadLocalTotals(dataset: DatasetId, period: string, gm: string) {
  const spec = specOf(dataset);
  const key = await totalKey(spec.local, spec.topic);
  const digits = gm.slice(2);
  const rows = await odata(spec.local, "TypedDataSet", {
    $select: `WijkenEnBuurten,${spec.measure}`,
    $filter: `${spec.topic} eq ${quote(key)} and Perioden eq ${quote(period)} and substringof(${quote(digits)},WijkenEnBuurten)`,
  });
  return rows
    .map((row) => ({
      code: String(row.WijkenEnBuurten ?? "").trim(),
      value: asCount(row[spec.measure]),
    }))
    .filter((row) => row.code.startsWith("BU") || row.code.startsWith("WK"));
}

export async function loadLocalDetail(dataset: DatasetId, period: string, code: string) {
  const spec = specOf(dataset);
  const [list, rows] = await Promise.all([
    odata(spec.local, spec.topic, { $select: "Key,Title" }) as Promise<CodeRow[]>,
    odata(spec.local, "TypedDataSet", {
      $select: `${spec.topic},${spec.measure}`,
      $filter: `Perioden eq ${quote(period)} and substringof(${quote(code)},WijkenEnBuurten)`,
    }),
  ]);
  const titles = Object.fromEntries(list.map((row) => [row.Key.trim(), row.Title]));
  return rows
    .map((row) => {
      const topic = String(row[spec.topic] ?? "").trim();
      return {
        code: topic,
        label: titles[topic] ?? topic,
        value: asCount(row[spec.measure]),
      };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

type Geo = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

export async function loadBuurten(gm: string, bbox: [number, number, number, number]) {
  const [minX, minY, maxX, maxY] = bbox;
  let url: string | undefined =
    "https://api.pdok.nl/cbs/gebiedsindelingen/ogc/v1/collections/buurt_gegeneraliseerd/items" +
    `?f=json&limit=200&jaarcode=2025&bbox=${minX},${minY},${maxX},${maxY}`;
  const features: { type: "Feature"; properties: { code: string; name: string }; geometry: Geo }[] = [];
  let pages = 0;
  while (url && pages < 4) {
    pages += 1;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Neighbourhood map failed to load.");
    const payload = (await response.json()) as {
      features?: { properties: { gm_code: string; statcode: string; statnaam: string }; geometry: Geo }[];
      links?: { rel: string; href: string }[];
    };
    const batch = payload.features ?? [];
    for (const feature of batch) {
      if (feature.properties.gm_code !== gm) continue;
      features.push({
        type: "Feature",
        properties: { code: feature.properties.statcode, name: feature.properties.statnaam },
        geometry: feature.geometry,
      });
    }
    const next = payload.links?.find((link) => link.rel === "next")?.href;
    url = batch.length >= 200 ? next : undefined;
  }
  return features;
}

